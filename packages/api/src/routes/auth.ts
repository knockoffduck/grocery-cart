import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import PocketBase from 'pocketbase';
import { PB_URL } from '../lib/pb';
import { getUserFromToken } from '../lib/auth';
import { LoginSchema, SignupSchema } from '@aldi-cart/shared';

const auth = new Hono();

const PB_ERROR_MESSAGES: Record<string, string> = {
  '400': 'Email or password is incorrect.',
  '409': 'An account with that email already exists.',
};

function pbErrorMessage(e: any, fallback: string): string {
  const status = e?.status ?? e?.code;
  if (status && PB_ERROR_MESSAGES[String(status)]) {
    return PB_ERROR_MESSAGES[String(status)];
  }
  if (e?.response?.message) return e.response.message;
  return fallback;
}

// POST /api/auth/login
auth.post('/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ errors: parsed.error.flatten().fieldErrors }, 400);
  }

  try {
    const pb = new PocketBase(PB_URL);
    const result = await pb.collection('users').authWithPassword(
      parsed.data.email,
      parsed.data.password,
    );
    setCookie(c, 'pb_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ message: pbErrorMessage(e, 'Sign-in failed. Please try again.') }, 401);
  }
});

// POST /api/auth/signup
auth.post('/auth/signup', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ errors: parsed.error.flatten().fieldErrors }, 400);
  }

  try {
    const pb = new PocketBase(PB_URL);
    const displayName =
      parsed.data.name?.trim() || parsed.data.email.split('@')[0];

    await pb.collection('users').create({
      email: parsed.data.email,
      password: parsed.data.password,
      passwordConfirm: parsed.data.password,
      name: displayName,
      role: 'user',
    });

    const result = await pb.collection('users').authWithPassword(
      parsed.data.email,
      parsed.data.password,
    );

    setCookie(c, 'pb_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ message: pbErrorMessage(e, 'Sign-up failed. Please try again.') }, 400);
  }
});

// POST /api/auth/logout
auth.post('/auth/logout', (c) => {
  deleteCookie(c, 'pb_token', { path: '/' });
  return c.json({ ok: true });
});

// GET /api/auth/me
auth.get('/auth/me', async (c) => {
  const token = getCookie(c, 'pb_token');
  if (!token) return c.json({ user: null });
  const user = await getUserFromToken(token);
  if (!user) return c.json({ user: null });
  return c.json({
    user: { email: user.email, role: user.role ?? 'user' },
  });
});

export { auth as authRoutes };
