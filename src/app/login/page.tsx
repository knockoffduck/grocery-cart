import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign in — Aldi Cart',
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main className="min-h-dvh flex flex-col bg-aldi-bg">
      <header className="bg-aldi-blue text-white safe-top shadow-md">
        <div className="max-w-2xl w-full mx-auto px-4 py-3 flex items-baseline gap-2">
          <span className="font-black text-2xl tracking-tight">ALDI</span>
          <span className="text-sm font-medium opacity-90">Sign in</span>
        </div>
      </header>
      <section className="flex-1 max-w-md w-full mx-auto px-4 py-8">
        <LoginForm />
      </section>
    </main>
  );
}
