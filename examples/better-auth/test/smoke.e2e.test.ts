import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createPostgresControlClient } from '@prisma/orm-postgres/control';
import { createDevDatabase, type DevDatabase, timeouts } from '@repo/test-utils';
import next from 'next';
import { join } from 'pathe';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

const exampleDir = fileURLToPath(new URL('..', import.meta.url));

let database: DevDatabase | undefined;
let server: Server | undefined;
let app: ReturnType<typeof next> | undefined;
let baseUrl: string;

async function createTables(connection: string): Promise<void> {
  const control = createPostgresControlClient({ connection });
  try {
    const init = await control.dbInit({
      invocation: { cwd: exampleDir, configPath: undefined, dbGiven: false },
      contract: contractJson,
      mode: 'apply',
      migrationsDir: join(exampleDir, 'migrations'),
    });
    if (!init.ok) throw new Error(JSON.stringify(init.failure, null, 2));
  } finally {
    await control.close();
  }
}

async function startApp(): Promise<void> {
  server = createServer();
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  vi.stubEnv('BETTER_AUTH_URL', baseUrl);
  app = next({ dev: true, dir: exampleDir, hostname: '127.0.0.1', port });
  await app.prepare();
  const handle = app.getRequestHandler();
  server.on('request', (request, response) => void handle(request, response));
}

beforeAll(async () => {
  database = await createDevDatabase();
  await createTables(database.connectionString);
  vi.stubEnv('DATABASE_URL', database.connectionString);
  vi.stubEnv('BETTER_AUTH_SECRET', 'a-test-secret-that-is-long-enough-for-better-auth');
  await startApp();
}, timeouts.spinUpPpgDev);

afterAll(async () => {
  await app?.close();
  await new Promise((resolve) => server?.close(resolve));
  await database?.close();
  vi.unstubAllEnvs();
}, timeouts.spinUpPpgDev);

function post(path: string, body: unknown, cookie = ''): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl, cookie },
    body: JSON.stringify(body),
  });
}

function get(path: string, cookie = ''): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { cookie } });
}

function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

it('signs up, signs in, shows the user on the home page and signs out', async () => {
  const credentials = { email: 'ada@example.com', password: 'a-long-password' };

  const signedUp = await post('/api/auth/sign-up/email', { ...credentials, name: 'Ada Lovelace' });
  expect(signedUp.status).toBe(200);
  expect(await signedUp.json()).toMatchObject({ user: { email: 'ada@example.com' } });

  const signedIn = await post('/api/auth/sign-in/email', credentials);
  expect(signedIn.status).toBe(200);
  const cookie = cookieFrom(signedIn);

  const session = await get('/api/auth/get-session', cookie);
  expect(await session.json()).toMatchObject({
    user: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });

  const home = await (await get('/', cookie)).text();
  expect(home).toContain('Ada Lovelace');
  expect(home).toContain('ada@example.com');

  const signedOut = await post('/api/auth/sign-out', {}, cookie);
  expect(await signedOut.json()).toEqual({ success: true });

  expect(await (await get('/api/auth/get-session', cookie)).json()).toBeNull();
  expect(await (await get('/', cookie)).text()).toContain('Not signed in');
});
