import { requireAdmin } from '@/lib/dal';
import { getSyncProgress } from '@/lib/sync-runner';
import { AdminSyncPanel } from '@/components/admin/AdminSyncPanel';
import { LogoutButton } from '@/components/auth/LogoutButton';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin — Aldi Cart' };

export default async function AdminPage() {
  const user = await requireAdmin();
  const initial = await getSyncProgress();
  return (
    <main className="min-h-dvh flex flex-col bg-aldi-bg">
      <header className="bg-aldi-blue text-white safe-top shadow-md">
        <div className="max-w-2xl w-full mx-auto px-4 py-3 flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className="font-black text-2xl tracking-tight">ALDI</span>
            <span className="text-sm font-medium opacity-90">Admin</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/" className="opacity-90 hover:opacity-100 underline">
              Back to cart
            </Link>
          </div>
        </div>
      </header>
      <section className="flex-1 max-w-2xl w-full mx-auto px-4 py-6 space-y-6">
        <div className="bg-white border border-aldi-border rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-aldi-text-muted">Signed in as admin</div>
            <div className="text-sm font-medium text-aldi-text">{user.email}</div>
          </div>
          <LogoutButton />
        </div>

        <AdminSyncPanel initial={initial} />
      </section>
    </main>
  );
}
