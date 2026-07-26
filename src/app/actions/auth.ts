'use server';

import 'server-only';
import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import PocketBase from 'pocketbase';
import { PB_URL } from '@/lib/pb';

const PasswordSchema = z
  .string()
  .min(8, { message: 'Be at least 8 characters long' });

const EmailSchema = z
  .string()
  .email({ message: 'Please enter a valid email.' })
  .trim();

const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, { message: 'Required' }),
});

const SignupSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: z.string().max(120).optional(),
});

export type AuthFormState = {
  errors?: { email?: string[]; password?: string[]; name?: string[] };
  message?: string;
} | undefined;

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

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const pb = new PocketBase(PB_URL);
    const result = await pb.collection('users').authWithPassword(
      parsed.data.email,
      parsed.data.password,
    );

    // Store the JWT token in an httpOnly cookie
    const cookieStore = await cookies();
    cookieStore.set('pb_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  } catch (e: any) {
    return { message: pbErrorMessage(e, 'Sign-in failed. Please try again.') };
  }
  redirect('/');
}

export async function signupAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = SignupSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    name: (formData.get('name') as string) || undefined,
  });
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  try {
    const pb = new PocketBase(PB_URL);
    const displayName =
      parsed.data.name?.trim() || parsed.data.email.split('@')[0];

    // Create the user (public signup)
    await pb.collection('users').create({
      email: parsed.data.email,
      password: parsed.data.password,
      passwordConfirm: parsed.data.password,
      name: displayName,
      role: 'user',
    });

    // Auto sign-in after signup
    const result = await pb.collection('users').authWithPassword(
      parsed.data.email,
      parsed.data.password,
    );

    const cookieStore = await cookies();
    cookieStore.set('pb_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  } catch (e: any) {
    return { message: pbErrorMessage(e, 'Sign-up failed. Please try again.') };
  }
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete('pb_token');
  redirect('/');
}
