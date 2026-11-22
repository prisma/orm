import { afterAll, beforeAll, expect, it } from 'vitest';
import { copyProject, type ProjectCopy, run, testSecret } from './project';

let project: ProjectCopy;
let auth: typeof import('../src/lib/auth')['auth'];
let db: typeof import('../src/lib/db')['db'];

beforeAll(async () => {
  project = await copyProject();
  expect((await run(project, 'prisma', ['db', 'init'])).exitCode).toBe(0);
  process.env['SQLITE_PATH'] = project.databasePath;
  process.env['BETTER_AUTH_SECRET'] = testSecret;
  ({ auth } = await import('../src/lib/auth'));
  ({ db } = await import('../src/lib/db'));
});

afterAll(async () => {
  await db?.close();
  await project?.remove();
});

function sessionCookie(headers: Headers): Headers {
  const cookies = headers.getSetCookie().map((cookie) => cookie.split(';')[0]);
  return new Headers({ cookie: cookies.join('; ') });
}

it('signs a user up, signs in, reads the session and signs out', async () => {
  const credentials = { email: 'ada@example.com', password: 'a-long-password' };
  const signedUp = await auth.api.signUpEmail({ body: { ...credentials, name: 'Ada' } });
  expect(signedUp.user).toMatchObject({ email: 'ada@example.com', name: 'Ada' });

  const signedIn = await auth.api.signInEmail({ body: credentials, returnHeaders: true });
  const headers = sessionCookie(signedIn.headers);

  const session = await auth.api.getSession({ headers });
  expect(session?.user).toMatchObject({ email: 'ada@example.com' });

  expect(await auth.api.signOut({ headers })).toEqual({ success: true });
  expect(await auth.api.getSession({ headers })).toBeNull();
});
