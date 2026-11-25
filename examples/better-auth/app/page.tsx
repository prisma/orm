import { headers } from 'next/headers';
import Link from 'next/link';
import { auth } from '../src/lib/auth';
import { SignOutButton } from './sign-out-button';

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return (
      <main>
        <h1>Not signed in</h1>
        <p>
          <Link href="/sign-in">Sign in</Link> or <Link href="/sign-up">sign up</Link>.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Signed in as {session.user.name}</h1>
      <p>{session.user.email}</p>
      <SignOutButton />
    </main>
  );
}
