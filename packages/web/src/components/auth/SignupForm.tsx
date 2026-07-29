import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    <Card className="gap-4 p-6">
      <CardHeader className="px-0">
        <h1 className="text-xl font-semibold text-aldi-text">Create account</h1>
        <p className="text-sm text-aldi-text-muted mt-1">
          Already have one?{' '}
          <Link to="/login" className="text-aldi-blue font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </CardHeader>

      <CardContent className="space-y-4 px-0">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            aria-invalid={!!errors.email}
          />
          {errors.email && (
            <p className="text-xs text-red-600">{errors.email[0]}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="name">
            Name <span className="text-aldi-text-muted font-normal">(optional)</span>
          </Label>
          <Input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
            aria-invalid={!!errors.password}
          />
          {errors.password && (
            <ul className="text-xs text-red-600 space-y-0.5">
              {errors.password.map((err, i) => (
                <li key={i}>- {err}</li>
              ))}
            </ul>
          )}
          {!errors.password && (
            <p className="text-xs text-aldi-text-muted">At least 8 characters.</p>
          )}
        </div>

        {message && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {message}
          </p>
        )}

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
      </CardContent>
    </Card>
  );
}
