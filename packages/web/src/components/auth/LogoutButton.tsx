import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  async function handleLogout() {
    setPending(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
      navigate('/');
      window.location.reload();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={pending}
      className="text-xs text-aldi-text-muted hover:text-aldi-text underline"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
