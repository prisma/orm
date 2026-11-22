import type { Where } from '@better-auth/core/db/adapter';
import { blindCast } from '@prisma/orm-framework/utils/casts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAdapter } from '../../src/adapter';
import {
  type AdapterDatabases,
  createAdapterDatabases,
  probeOptions,
  probePsl,
} from '../helpers/adapter-databases';
import { targets } from '../helpers/databases';
import { timeouts } from '../timeouts';

let databases: AdapterDatabases;

beforeAll(async () => {
  databases = await createAdapterDatabases();
}, timeouts.devServerStart);

afterAll(() => databases?.dispose(), timeouts.devServerClose + timeouts.hook);

const rows = [
  { id: '1', text: 'Alice@Example.com', n: 1 },
  { id: '2', text: 'alice@example.com', n: 1 },
  { id: '3', text: null, n: 2 },
  { id: '4', text: '', n: 2 },
  { id: '5', text: 'École', n: 3 },
  { id: '6', text: 'ΟΔΟΣ', n: 3 },
  { id: '7', text: '50%_off!', n: 4 },
  { id: '8', text: 'ab', n: 4 },
];

const nonNull = ['1', '2', '4', '5', '6', '7', '8'];

describe.each(targets)('filters on %s', (target) => {
  let adapter: ReturnType<ReturnType<typeof prismaAdapter>>;

  beforeAll(async () => {
    adapter = prismaAdapter(await databases.open(target, probePsl(databases, target)))(
      probeOptions,
    );
    for (const row of rows) {
      await adapter.create({ model: 'probe', data: row, forceAllowId: true });
    }
  }, timeouts.hook);

  async function ids(where: Where[]): Promise<string[]> {
    const found = await adapter.findMany<{ id: string }>({ model: 'probe', where, limit: 100 });
    return found.map((row) => row.id).sort();
  }

  const text = (
    operator: NonNullable<Where['operator']>,
    value: Where['value'],
    mode?: Where['mode'],
  ): Where =>
    mode === undefined
      ? { field: 'text', operator, value }
      : { field: 'text', operator, value, mode };

  describe('case-sensitive pattern operators', () => {
    it('do not match another case', async () => {
      expect(await ids([text('contains', 'Example')])).toEqual(['1']);
      expect(await ids([text('starts_with', 'Alice')])).toEqual(['1']);
      expect(await ids([text('ends_with', 'Example.com')])).toEqual(['1']);
    });

    it('match %, _ and ! literally', async () => {
      expect(await ids([text('contains', '%_')])).toEqual(['7']);
      expect(await ids([text('starts_with', '50%')])).toEqual(['7']);
      expect(await ids([text('ends_with', '_off!')])).toEqual(['7']);
      expect(await ids([text('contains', '_')])).toEqual(['7']);
    });

    it('treat the empty pattern as any value that is not null', async () => {
      for (const operator of ['contains', 'starts_with', 'ends_with'] as const) {
        expect(await ids([text(operator, '')])).toEqual(nonNull);
        expect(await ids([text(operator, '', 'insensitive')])).toEqual(nonNull);
      }
    });

    it('do not match a value longer than the field', async () => {
      expect(await ids([text('starts_with', 'abc')])).toEqual([]);
      expect(await ids([text('ends_with', 'xab')])).toEqual([]);
      expect(await ids([text('contains', 'xab')])).toEqual([]);
    });

    it('never match a NULL field', async () => {
      expect(await ids([text('contains', 'a')])).not.toContain('3');
      expect(await ids([text('ne', 'ab')])).not.toContain('3');
    });
  });

  describe('AND and OR', () => {
    it('an AND-only where', async () => {
      expect(
        await ids([text('starts_with', 'a'), { field: 'n', operator: 'eq', value: 1 }]),
      ).toEqual(['2']);
    });

    it('an OR-only where', async () => {
      expect(
        await ids([
          { ...text('eq', 'ab'), connector: 'OR' },
          { ...text('eq', 'École'), connector: 'OR' },
        ]),
      ).toEqual(['5', '8']);
    });

    it('AND clauses and one OR group', async () => {
      expect(
        await ids([
          { field: 'n', operator: 'eq', value: 1 },
          { ...text('eq', 'alice@example.com'), connector: 'OR' },
          { ...text('eq', 'ab'), connector: 'OR' },
        ]),
      ).toEqual(['2']);
    });
  });

  describe('lists and null', () => {
    it('eq null finds NULL fields and ne null the others', async () => {
      expect(await ids([text('eq', null)])).toEqual(['3']);
      expect(await ids([text('ne', null)])).toEqual(nonNull);
    });

    it('in and not_in drop null entries, and an empty list matches no row', async () => {
      const withNull = blindCast<
        string[],
        "Better Auth's Where type has no null list entries, but its callers can pass them"
      >(['ab', null]);
      expect(await ids([text('in', withNull)])).toEqual(['8']);
      expect(await ids([text('not_in', withNull)])).toEqual(['1', '2', '4', '5', '6', '7']);
      expect(await ids([{ field: 'n', operator: 'in', value: [] }])).toEqual([]);
    });

    it('an empty not_in matches every row', async () => {
      expect(await ids([{ field: 'n', operator: 'not_in', value: [] }])).toEqual(
        rows.map((row) => row.id).sort(),
      );
    });
  });

  describe('insensitive mode', () => {
    it('pattern operators with a value no row contains match nothing', async () => {
      for (const operator of ['contains', 'starts_with', 'ends_with'] as const) {
        expect(await ids([text(operator, 'zzz', 'insensitive')])).toEqual([]);
      }
    });

    it('pattern operators match either case', async () => {
      expect(await ids([text('contains', 'eXaMpLe', 'insensitive')])).toEqual(['1', '2']);
      expect(await ids([text('starts_with', 'ALICE', 'insensitive')])).toEqual(['1', '2']);
      expect(await ids([text('ends_with', 'EXAMPLE.COM', 'insensitive')])).toEqual(['1', '2']);
    });

    it('a stored value always matches itself', async () => {
      expect(await ids([text('eq', 'École', 'insensitive')])).toEqual(['5']);
      expect(await ids([text('eq', 'ΟΔΟΣ', 'insensitive')])).toEqual(['6']);
      expect(await ids([text('in', ['ΟΔΟΣ', 'ALICE@example.com'], 'insensitive')])).toEqual([
        '1',
        '2',
        '6',
      ]);
    });

    it('ne and not_in leave out either case', async () => {
      expect(await ids([text('ne', 'ALICE@EXAMPLE.COM', 'insensitive')])).toEqual([
        '4',
        '5',
        '6',
        '7',
        '8',
      ]);
      expect(await ids([text('not_in', ['ALICE@EXAMPLE.COM', 'AB'], 'insensitive')])).toEqual([
        '4',
        '5',
        '6',
        '7',
      ]);
    });

    it('is ignored for a value that is not a string', async () => {
      expect(await ids([{ field: 'n', operator: 'eq', value: 3, mode: 'insensitive' }])).toEqual([
        '5',
        '6',
      ]);
    });
  });
});
