import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { getUserFromToken } from '../lib/auth';

export async function requireUser(c: Context, next: Next) {
  const token = getCookie(c, 'pb_token');
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const user = await getUserFromToken(token);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', user);
  await next();
}

export async function requireAdmin(c: Context, next: Next) {
  const token = getCookie(c, 'pb_token');
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const user = await getUserFromToken(token);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  c.set('user', user);
  await next();
}
