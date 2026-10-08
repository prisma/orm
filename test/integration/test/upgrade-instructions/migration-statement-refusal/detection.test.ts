import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

const FRAGMENT_PATH =
  'upgrade-instructions/pending/migration-statement-refusal/app/instructions.md';

const here = dirname(fileURLToPath(import.meta.url));
const fragment = readFileSync(join(here, '../../../../..', FRAGMENT_PATH), 'utf-8');

function detectionOf(id: string): readonly RegExp[] {
  const entry = fragment.split(/\n {2}- id: /).find((block) => block.startsWith(`${id}\n`));
  if (entry === undefined) throw new Error(`The fragment has no change ${id}`);
  return [...entry.matchAll(/^ {8}- '(.*)'$/gm)].map(
    ([, pattern]) => new RegExp((pattern ?? '').replaceAll("''", "'")),
  );
}

function detects(id: string, content: string): boolean {
  return detectionOf(id).some((pattern) => pattern.test(content));
}

describe('db-update-confirm-no-longer-consents detection', () => {
  it('finds --confirm on a db update command line', () => {
    expect(
      detects('db-update-confirm-no-longer-consents', 'prisma db update --confirm appdb'),
    ).toBe(true);
  });

  it('finds --confirm on a db update command continued over several lines', () => {
    const script = 'pnpm prisma db update \\\n  --no-interactive \\\n  --confirm appdb\n';
    expect(detects('db-update-confirm-no-longer-consents', script)).toBe(true);
  });

  it('skips a --confirm that belongs to a later command', () => {
    const script = 'pnpm prisma db update --json\npnpm prisma orm init --confirm my-app\n';
    expect(detects('db-update-confirm-no-longer-consents', script)).toBe(false);
  });

  it('skips a longer flag that starts with --confirm', () => {
    expect(detects('db-update-confirm-no-longer-consents', 'prisma db update --confirmed')).toBe(
      false,
    );
  });
});
