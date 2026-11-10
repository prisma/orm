import { defineContract } from '@internal/postgres/contract-builder';
import { describe, expect, it } from 'vitest';
import { authorSqlContractFromPsl } from '../scalar-lists/psl-list-authoring';

const MICROSECONDS = '2024-01-01T01:00:00.123456Z';

describe('a default with digits below a millisecond on a field read as a Date', () => {
  it('is refused in PSL, naming the types that hold it', async () => {
    const authored = await authorSqlContractFromPsl(`model Event {
  id Int                    @id
  at DateTime(precision: 6) @default(timestamptz\`${MICROSECONDS}\`)
}`);
    expect(authored.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_DEFAULT_LITERAL',
        message: expect.stringContaining('TimestamptzString'),
      }),
    ]);
  });

  it('cannot be written in the TypeScript builder, whose Date default is stored at the millisecond', () => {
    const contract = defineContract({}, ({ type, field, model }) => ({
      models: {
        Event: model('Event', {
          fields: {
            id: field.column(type.Int()).id(),
            at: field
              .column(type.DateTime({ precision: 6 }))
              .default(new Date('2024-01-01T01:00:00.123Z')),
          },
        }).sql({ table: 'event' }),
      },
    }));
    expect(
      contract.storage.namespaces['public']?.entries.table?.['event']?.columns['at']?.default,
    ).toEqual({
      kind: 'literal',
      value: '2024-01-01T01:00:00.123Z',
    });
  });

  it('in a list, is reported at that element, though a later element is refused too', async () => {
    const authored = await authorSqlContractFromPsl(`model Event {
  id Int                      @id
  at DateTime(precision: 6)[] @default([timestamptz\`2024-01-01T01:00:00.123Z\`, timestamptz\`${MICROSECONDS}\`, "soon"])
}`);
    expect(authored.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_DEFAULT_LITERAL',
        message: expect.stringMatching(/^Field "Event\.at" at element 2: .*TimestamptzString/),
      }),
    ]);
  });

  it('is accepted at a millisecond', async () => {
    const authored = await authorSqlContractFromPsl(`model Event {
  id Int                    @id
  at DateTime(precision: 6) @default(timestamptz\`2024-01-01T01:00:00.123Z\`)
}`);
    expect(authored.diagnostics).toEqual([]);
  });
});
