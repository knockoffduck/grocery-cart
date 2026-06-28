import Link from 'next/link';

export default function Forbidden() {
  return (
    <main className="min-h-dvh flex items-center justify-center bg-aldi-bg px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 text-center border border-aldi-border">
        <div className="text-aldi-blue text-5xl font-black mb-2">403</div>
        <h1 className="text-xl font-semibold text-aldi-text mb-2">
          Forbidden
        </h1>
        <p className="text-aldi-text-muted text-sm mb-6">
          You are signed in, but your account does not have admin access.
        </p>
        <Link
          href="/"
          className="inline-block bg-aldi-blue text-white px-5 py-2 rounded-lg text-sm font-medium hover:opacity-90"
        >
          Back to cart
        </Link>
      </div>
    </main>
  );
}
