'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { authClient } from '../../src/lib/auth-client';
import { failureMessage } from '../../src/lib/failure-message';

export default function SignUp() {
  const router = useRouter();
  const [error, setError] = useState<string>();

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { error } = await authClient.signUp.email({
      name: String(form.get('name')),
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    if (error) {
      setError(failureMessage(error, 'Sign up'));
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main>
      <h1>Sign up</h1>
      <form onSubmit={signUp}>
        <p>
          <label>
            Name <input name="name" required />
          </label>
        </p>
        <p>
          <label>
            Email <input name="email" type="email" required />
          </label>
        </p>
        <p>
          <label>
            Password <input name="password" type="password" minLength={8} required />
          </label>
        </p>
        {error && <p role="alert">{error}</p>}
        <button type="submit">Sign up</button>
      </form>
      <p>
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
