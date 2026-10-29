import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { describe, expect, it } from 'vitest';
import { interpretSchemaTextResult, serializedTable } from './support';

const SCHEMA = `datasource db {
  provider = "postgresql"
}

model Event {
  id Int      @id
  at DateTime
}
`;

const bindingWithDateTime = (args: readonly unknown[]) => ({
  ...prisma7PostgresBinding,
  typeMap: {
    ...prisma7PostgresBinding.typeMap,
    scalars: {
      ...prisma7PostgresBinding.typeMap.scalars,
      DateTime: { constructorName: 'DateTime', args },
    },
  },
});

describe('a Prisma 7 type the binding maps to a type choice', () => {
  it('becomes the explicit type the values choose', () => {
    const result = interpretSchemaTextResult(
      SCHEMA,
      bindingWithDateTime(['jsDate', 'timestamp', 3]),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    expect(serializedTable(result.value as Contract<SqlStorage>, 'Event').columns['at']).toEqual({
      codecId: 'pg/timestamp-date@1',
      dataType: 'pg/timestamp',
      many: false,
      nullable: false,
      typeParams: { precision: 3 },
    });
  });

  it('names the field and the binding when the values choose no type', () => {
    expect(() =>
      interpretSchemaTextResult(SCHEMA, bindingWithDateTime(['jsDate', 'timetz'])),
    ).toThrow(
      'The Prisma 7 target binding maps Field "Event.at" to type choice "DateTime" with values it refuses: Argument "storage" of DateTime is timetz; write one of: timestamptz, timestamp.',
    );
  });
});
