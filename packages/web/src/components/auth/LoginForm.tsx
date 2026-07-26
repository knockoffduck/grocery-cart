import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';

interface FormErrors {
  email?: string[];
  password?: string[];
}

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setErrors({});
    setMessage(null);
    try {
      const res = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.errors) setErrors(data.errors);
        if (data.message) setMessage(data.message);
        return;
      }
      navigate('/');
    } catch {
      setMessage('Network error. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-aldi-border rounded-2xl p-6 space-y-4 shadow-sm">
      <div>
        <h1 className="text-xl font-semibold text-aldi-text">Sign in</h1>
        <p className="text-sm text-aldi-text-muted mt-1">
          New here?{' '}
          <Link to="/signup" className="text-aldi-blue font-medium hover:underline">
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
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className="w-full border border-aldi-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aldi-blue/40"
        />
        {errors.email && (
          <p className="text-xs text-red-600 mt-1">{errors.email[0]}</p>
        )}
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-aldi-text mb-1">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="w-full border border-aldi-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aldi-blue/40"
        />
        {errors.password && (
          <p className="text-xs text-red-600 mt-1">{errors.password[0]}</p>
        )}
      </div>

      {message && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {message}
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
