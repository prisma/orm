import { describe, expect, it } from 'vitest';
import { postgresDataTypeEntries } from '../src/core/data-type-entries';
import {
  pgBytea,
  pgDate,
  pgInterval,
  pgJson,
  pgJsonb,
  pgText,
  pgTime,
  pgTimestamp,
  pgTimestamptz,
  pgTimetz,
} from '../src/core/data-types';
import { prisma7PostgresBinding } from '../src/core/prisma7-binding';

const formOf = (dataType: string) =>
  prisma7PostgresBinding.literalDefaultForm({ dataType, typeParams: undefined });

const entryTagOf = (dataType: string) => {
  const written = postgresDataTypeEntries()[dataType]?.written;
  return written?.kind === 'tag' ? written.tag : undefined;
};

describe('the Prisma 7 binding reads a quoted default', () => {
  it.each([pgBytea, pgDate, pgTime, pgTimetz, pgTimestamp, pgTimestamptz])(
    'as the body of the tag the authoring entry of $id writes',
    (type) => {
      const form = formOf(type.id);
      expect({ kind: form?.kind, tag: form?.kind === 'tag' ? form.tag : undefined }).toEqual({
        kind: 'tag',
        tag: entryTagOf(type.id),
      });
    },
  );

  it('as JSON text on a JSON column', () => {
    expect([formOf(pgJson.id), formOf(pgJsonb.id)]).toEqual([{ kind: 'json' }, { kind: 'json' }]);
  });

  it('as written on a column Prisma 7 writes no tagged default for', () => {
    expect([formOf(pgText.id), formOf(pgInterval.id)]).toEqual([undefined, undefined]);
  });
});
