import { Link } from 'react-router-dom';
import { SignupForm } from '@/components/auth/SignupForm';

export function SignupPage() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <span className="font-black text-3xl text-aldi-blue tracking-tight">ALDI</span>
          <span className="text-sm text-aldi-text-muted ml-2">Shopping Cart</span>
        </div>
        <SignupForm />
        <p className="text-center text-xs text-aldi-text-muted mt-4">
          <Link to="/" className="hover:underline">← Back to cart</Link>
        </p>
      </div>
    </div>
  );
}
