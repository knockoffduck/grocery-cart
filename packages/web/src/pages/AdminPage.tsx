import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AdminSyncPanel } from '@/components/admin/AdminSyncPanel';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { api } from '@/lib/api';

export function AdminPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (!data.user || data.user.role !== 'admin') {
          navigate('/login');
        } else {
          setAuthorized(true);
        }
      })
      .catch(() => navigate('/login'));
  }, [navigate]);

  if (authorized === null) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-aldi-text-muted">
        Checking access…
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="bg-aldi-blue text-white safe-top shadow-md">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="font-black text-xl tracking-tight">ALDI</span>
            <span className="text-sm font-medium opacity-90">Admin</span>
          </div>
          <nav className="flex items-center gap-3 text-sm">
            <Link to="/" className="opacity-90 hover:opacity-100 hover:underline">
              ← Cart
            </Link>
            <LogoutButton />
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6">
        <AdminSyncPanel />
      </main>
    </div>
  );
}
