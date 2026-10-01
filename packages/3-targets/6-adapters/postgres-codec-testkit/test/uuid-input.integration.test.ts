import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { pgText, pgUuid } from '@internal/target-postgres/data-types';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The forms the PostgreSQL documentation lists for uuid input, then text that is close to one and is not.
const candidates: readonly (readonly [text: string, isUuid: boolean])[] = [
  ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', true],
  ['A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11', true],
  ['{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}', true],
  ['a0eebc999c0b4ef8bb6d6bb9bd380a11', true],
  ['a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11', true],
  ['{a0eebc99-9c0b4ef8-bb6d6bb9-bd380a11}', true],
  ['{A0EEBC999C0B4EF8BB6D6BB9BD380A11}', true],
  ['not-a-uuid', false],
  ['', false],
  ['{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', false],
  ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}', false],
  ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a1', false],
  ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a111', false],
  ['a0eebc99--9c0b-4ef8-bb6d-6bb9bd380a11', false],
  ['a0e-ebc99-9c0b-4ef8-bb6d-6bb9bd380a11', false],
  ['-a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', false],
  ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11-', false],
  [' a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', false],
  ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 ', false],
  ['g0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', false],
  ['(a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11)', false],
];

describe('the text to uuid cast and pg/uuid@1 decodeJson', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let driver: Awaited<ReturnType<typeof postgresControlDriverDescriptor.create>> | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    driver = await postgresControlDriverDescriptor.create(database.connectionString);
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await driver?.close();
    await database?.close();
  }, timeouts.spinUpPpgDev);

  it(
    'the cast writes what PostgreSQL writes for each uuid it reads, and decodeJson reads only that form',
    async () => {
      const codec = postgresCodecDescriptorRegistry.descriptorFor('pg/uuid@1')!.factory(undefined)({
        name: 'uuid-input',
      });
      const castFromText = pgUuid.casts[pgText.id]!;
      const results = [];
      for (const [text] of candidates) {
        let postgres: string | null;
        try {
          const result = await driver!.query<{ text: string }>('select $1::uuid::text as text', [
            text,
          ]);
          postgres = result.rows[0]!.text;
        } catch {
          postgres = null;
        }
        results.push({
          text,
          postgres,
          cast: resultOrNull(() => castFromText(text)),
          decodeJson: resultOrNull(() => codec.decodeJson(text)),
        });
      }

      const canonical = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      expect(results).toEqual(
        candidates.map(([text, isUuid]) => ({
          text,
          postgres: isUuid ? canonical : null,
          cast: isUuid ? canonical : null,
          decodeJson: text === canonical ? canonical : null,
        })),
      );
    },
    timeouts.spinUpPpgDev,
  );
});

function resultOrNull(run: () => unknown): unknown {
  try {
    return run();
  } catch {
    return null;
  }
}
