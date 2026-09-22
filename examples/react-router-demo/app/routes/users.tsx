import { Form, redirect } from 'react-router';
import { getDb } from '~/lib/db.server';
import type { Route } from './+types/users';

export async function loader() {
  const db = getDb();
  const plan = db.sql.public.user
    .select('id', 'email', 'createdAt')
    .orderBy('createdAt', { direction: 'desc' })
    .limit(20)
    .build();
  const rows = await db.runtime().query(plan);
  return { rows };
}

// This example is a validation harness for Prisma 8's Vite plugin auto-emit
// flow, not a production starter. The action deliberately omits server-side
// input validation (arktype/zod-style); a real app should validate `email`
// before persisting it. Browser-side `<input type="email" required />` is not
// a server-side guard.
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim();
  if (!email) {
    throw new Response('email required', { status: 400 });
  }
  const db = getDb();
  const plan = db.sql.public.user.insert([{ email }]).build();
  await db.runtime().execute(plan);
  return redirect('/');
}

export default function Users({ loaderData }: Route.ComponentProps) {
  return (
    <main>
      <h1>Users</h1>
      <Form method="post">
        <label>
          Email <input name="email" type="email" required />
        </label>
        <button type="submit">Create user</button>
      </Form>
      <ul>
        {loaderData.rows.map((row) => (
          <li key={row.id}>{row.email}</li>
        ))}
      </ul>
    </main>
  );
}
