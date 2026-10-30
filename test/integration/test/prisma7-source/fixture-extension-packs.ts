import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import paradedb from '@internal/extension-paradedb/control';
import pgvector from '@internal/extension-pgvector/control';
import postgis from '@internal/extension-postgis/control';
import { dirname, join } from 'pathe';

export const prisma7FixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/2-sql-family/2-authoring/contract-prisma7/test/fixtures',
);

const extensionPacks = new Map([pgvector, postgis, paradedb].map((pack) => [pack.id, pack]));

/** The extension packs a Prisma 7 reader fixture's `composed-extensions.json` lists, for the stack to compose. */
export function fixtureExtensionPacks(fixture: string) {
  const path = join(prisma7FixturesDir, fixture, 'composed-extensions.json');
  const packIds: readonly string[] = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
  return packIds.map((packId) => {
    const pack = extensionPacks.get(packId);
    if (pack === undefined)
      throw new Error(`Fixture "${fixture}" composes unknown pack "${packId}"`);
    return pack;
  });
}
