'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { authClient } from '../../src/lib/auth-client';
import { failureMessage } from '../../src/lib/failure-message';

export default function SignIn() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    try {
      const { error } = await authClient.signIn.email({
        email: String(form.get('email')),
        password: String(form.get('password')),
      });
      if (error) {
        setError(failureMessage(error, 'Sign in'));
        return;
      }
      router.push('/');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={signIn}>
        <p>
          <label>
            Email <input name="email" type="email" required />
          </label>
        </p>
        <p>
          <label>
            Password <input name="password" type="password" required />
          </label>
        </p>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p>
        No account yet? <Link href="/sign-up">Sign up</Link>
      </p>
    </main>
  );
}
