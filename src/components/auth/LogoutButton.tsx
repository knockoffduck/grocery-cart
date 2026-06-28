'use client';

import { useFormStatus } from 'react-dom';
import { logoutAction } from '@/app/actions/auth';

function Pending() {
  const { pending } = useFormStatus();
  return pending ? <span>Signing out…</span> : <span>Sign out</span>;
}

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="text-xs text-aldi-text-muted hover:text-aldi-text underline"
      >
        <Pending />
      </button>
    </form>
  );
}
