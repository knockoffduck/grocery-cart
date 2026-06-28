'use server';

import 'server-only';
import { z } from 'zod';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { APIError } from 'better-auth';
import { auth } from '@/lib/auth';

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

const BETTER_AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Email or password is incorrect.',
  USER_ALREADY_EXISTS: 'An account with that email already exists.',
  PASSWORD_TOO_SHORT: 'Password must be at least 8 characters.',
  PASSWORD_TOO_LONG: 'Password is too long.',
  INVALID_EMAIL: 'That email address does not look valid.',
};

function errorMessage(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  return BETTER_AUTH_ERROR_MESSAGES[code] ?? fallback;
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
    await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
  } catch (e) {
    if (e instanceof APIError) {
      return { message: errorMessage(e.body?.code, 'Sign-in failed.') };
    }
    return { message: 'Sign-in failed. Please try again.' };
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
    const displayName =
      parsed.data.name?.trim() || parsed.data.email.split('@')[0];
    await auth.api.signUpEmail({
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        name: displayName,
      },
      headers: await headers(),
    });
  } catch (e) {
    if (e instanceof APIError) {
      return { message: errorMessage(e.body?.code, 'Sign-up failed.') };
    }
    return { message: 'Sign-up failed. Please try again.' };
  }
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // Ignore — even if the session is already gone, the redirect
    // below clears any client-side state.
  }
  redirect('/');
}
