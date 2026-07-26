import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';

interface FormErrors {
  email?: string[];
  password?: string[];
}

export function SignupForm() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
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
      const res = await api('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password }),
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
        <h1 className="text-xl font-semibold text-aldi-text">Create account</h1>
        <p className="text-sm text-aldi-text-muted mt-1">
          Already have one?{' '}
          <Link to="/login" className="text-aldi-blue font-medium hover:underline">
            Sign in
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
        <label htmlFor="name" className="block text-sm font-medium text-aldi-text mb-1">
          Name <span className="text-aldi-text-muted font-normal">(optional)</span>
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className="w-full border border-aldi-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aldi-blue/40"
        />
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
          autoComplete="new-password"
          required
          minLength={8}
          className="w-full border border-aldi-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-aldi-blue/40"
        />
        {errors.password && (
          <ul className="text-xs text-red-600 mt-1 space-y-0.5">
            {errors.password.map((err, i) => (
              <li key={i}>- {err}</li>
            ))}
          </ul>
        )}
        {!errors.password && (
          <p className="text-xs text-aldi-text-muted mt-1">At least 8 characters.</p>
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
        {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
