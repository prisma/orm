'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '../src/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  const [error, setError] = useState<string>();

  async function signOut() {
    const { error } = await authClient.signOut();
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={signOut}>
        Sign out
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
