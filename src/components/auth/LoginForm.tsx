'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { loginAction, type AuthFormState } from '@/app/actions/auth';

const INITIAL: AuthFormState = undefined;

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={action} className="bg-white border border-aldi-border rounded-2xl p-6 space-y-4 shadow-sm">
      <div>
        <h1 className="text-xl font-semibold text-aldi-text">Sign in</h1>
        <p className="text-sm text-aldi-text-muted mt-1">
          New here?{' '}
          <Link href="/signup" className="text-aldi-blue font-medium hover:underline">
            Create an account
          </Link>
        </p>
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-aldi-text mb-1">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full border border-aldi-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aldi-blue/40"
        />
        {state?.errors?.email && (
          <p className="text-xs text-red-600 mt-1">{state.errors.email[0]}</p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-aldi-text mb-1">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full border border-aldi-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aldi-blue/40"
        />
        {state?.errors?.password && (
          <p className="text-xs text-red-600 mt-1">{state.errors.password[0]}</p>
        )}
      </div>

      {state?.message && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full bg-aldi-blue text-white rounded-lg py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
