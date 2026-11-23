'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '../src/lib/auth-client';
import { failureMessage } from '../src/lib/failure-message';

export function SignOutButton() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);
    try {
      const { error } = await authClient.signOut();
      if (error) {
        setError(failureMessage(error, 'Sign out'));
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" onClick={signOut} disabled={pending}>
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
