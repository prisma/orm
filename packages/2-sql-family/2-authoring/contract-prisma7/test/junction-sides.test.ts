import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

/**
 * Which list field owns junction column `A`. prisma-engines decides it in
 * `psl/parser-database/src/relations.rs` (`ingest_relation`): the side whose
 * model name is greater is skipped, and for a self relation the side whose
 * field name is greater, so the smaller name owns `field_a` and column `A`.
 */
describe('implicit many-to-many junction sides', () => {
  const contract: unknown = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        'fixtures/implicit-many-to-many/expected-contract.json',
      ),
      'utf8',
    ),
  );
  const relations = (
    contract as {
      domain: {
        namespaces: { public: { models: Record<string, { relations: Record<string, unknown> }> } };
      };
    }
  ).domain.namespaces.public.models;

  it('gives column A to the field whose name is smaller in a self relation', () => {
    expect(relations['User']?.relations).toMatchObject({
      followers: { through: { table: '_Follows', parentColumns: ['A'], childColumns: ['B'] } },
      following: { through: { table: '_Follows', parentColumns: ['B'], childColumns: ['A'] } },
    });
  });

  it('gives column A to the model whose name is smaller', () => {
    expect(relations['Post']?.relations).toMatchObject({
      tags: { through: { table: '_PostToTag', parentColumns: ['A'], childColumns: ['B'] } },
      fans: { through: { table: '_Favorites', parentColumns: ['A'], childColumns: ['B'] } },
    });
  });
});
