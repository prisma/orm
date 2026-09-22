import type { TargetId } from './code-templates';

/**
 * The minimum supported server version for each target. The
 * authoritative source of truth is each target package's
 * `package.json#prismaNext.minServerVersion` field — this module
 * mirrors those values and a workspace-level test asserts the two
 * never drift (`templates/tsconfig-env.test.ts`).
 *
 * Bumping a value here in isolation is **not** safe: edit the
 * corresponding target package's `package.json` first, then mirror
 * here. The scaffold's `.env.example` and the "Requirements" section
 * of `prisma-8.md` both read from this constant, so a stale value
 * lies to every freshly initialised user.
 */
export const MIN_SERVER_VERSION: Record<TargetId, string> = {
  postgres: '15',
  mongo: '8.0',
};

export const TARGET_LABEL: Record<TargetId, string> = {
  postgres: 'PostgreSQL',
  mongo: 'MongoDB',
};

/**
 * Renders the placeholder body shared by `.env` and `.env.example`:
 * the target-specific connection-string requirement comments and the
 * commented-shape `DATABASE_URL` line. The output is identical for both
 * authoring styles — the env file is orthogonal to PSL vs TS schema
 * authoring.
 */
function envPlaceholderBody(target: TargetId): string {
  const label = TARGET_LABEL[target];
  const minVersion = MIN_SERVER_VERSION[target];
  const lines: string[] = [];
  lines.push(`# Connection string for ${label}.`);
  lines.push(`# Requires ${label} >= ${minVersion}.`);
  lines.push('');
  if (target === 'postgres') {
    lines.push('DATABASE_URL="postgresql://user:password@localhost:5432/mydb"');
  } else {
    lines.push(
      '# Standalone local mongod / `docker run mongo:8` — no replica set required for first-run queries.',
    );
    lines.push(
      '# Transactions and change streams need a replica set; add ?replicaSet=... only after initiating one.',
    );
    lines.push('');
    lines.push('DATABASE_URL="mongodb://user:password@localhost:27017/mydb"');
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Renders the `.env.example` content for a given target:
 *
 * - Carries a "Copy this file to `.env`…" intro that only makes sense
 *   for the example file (the real `.env` is the destination of that
 *   copy and so does not get the same intro).
 * - Documents the `DATABASE_URL` placeholder in the target's native URL
 *   shape (Postgres: standard `postgresql://`, Mongo: `mongodb://` plus
 *   a `mydb` database segment so the lazy facade has a `dbName`).
 * - Carries a `# Requires <db> >= <version>` comment so a fresh user
 *   knows the minimum supported server before they first try to connect.
 */
export function envExampleContent(target: TargetId): string {
  const lines: string[] = [];
  lines.push(
    '# Copy this file to `.env` and replace the placeholder with your real connection string.',
  );
  lines.push(envPlaceholderBody(target));
  return lines.join('\n');
}

/**
 * Renders the initial `.env` content for `--write-env` / interactive
 * opt-in. Same placeholder body as `.env.example`, **without** the
 * example file's "Copy this file to `.env`…" intro: the real `.env` is
 * the destination of that copy, so the line would lie. Writing this
 * file is gitignored (`.env` lands in `.gitignore` during init).
 */
export function envFileContent(target: TargetId): string {
  return envPlaceholderBody(target);
}
