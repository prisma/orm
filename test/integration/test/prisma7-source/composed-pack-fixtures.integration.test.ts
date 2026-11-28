/**
 * The `contract-prisma7` fixtures that compose extension packs, read with the real packs composed as `contract emit` composes them, against the whole `expected-contract.json`. The reader package cannot depend on an extension pack, so these cases are asserted here and not in its own fixture test. Set `UPDATE_PRISMA7_FIXTURES=1` to rewrite the expected files after an intentional change.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  composedExtensionsPath,
  interpretPrisma7Fixture,
  prisma7FixturesDir,
} from './fixture-extension-packs';

const update = process.env['UPDATE_PRISMA7_FIXTURES'] === '1';

const packFixtures = readdirSync(prisma7FixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(composedExtensionsPath(entry.name)))
  .map((entry) => entry.name)
  .sort();

describe('Prisma 7 reader fixtures that compose extension packs', () => {
  it('finds the fixtures that compose a pack', () => {
    expect(packFixtures).toEqual([
      'extensions-pack-composed',
      'extensions-pack-composed-in-schema',
    ]);
  });

  for (const fixture of packFixtures) {
    it(`${fixture} reads as its expected contract`, async () => {
      const serializer = new PostgresContractSerializer();
      const serialized: unknown = JSON.parse(
        JSON.stringify(serializer.serializeContract(await interpretPrisma7Fixture(fixture))),
      );
      expect(() => serializer.deserializeContract(serialized)).not.toThrow();

      const expectedPath = join(prisma7FixturesDir, fixture, 'expected-contract.json');
      if (update) {
        writeFileSync(expectedPath, `${JSON.stringify(serialized, null, 2)}\n`);
        return;
      }
      expect(JSON.parse(readFileSync(expectedPath, 'utf8'))).toEqual(serialized);
    });
  }
});
