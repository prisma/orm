import type { BetterAuthOptions } from '@better-auth/core';
import type { DBFieldAttribute } from '@better-auth/core/db';
import { defineContract } from '@prisma/orm-postgres/contract-builder';
import { pgTextColumn, pgVarcharColumn } from '@prisma/orm-postgres/target/codecs';
import { describe, expect, it } from 'vitest';
import { compare, problemsOf } from '../helpers/printed-psl';

const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Probe: model('Probe', {
      fields: {
        id: field.column(pgTextColumn()).id(),
        value: field.column(pgVarcharColumn()),
      },
    }).sql({ table: 'probe' }),
  },
}));

function probeProblems(attribute: DBFieldAttribute): unknown[] {
  const options: BetterAuthOptions = {
    plugins: [{ id: 'probe', schema: { probe: { fields: { value: attribute } } } }],
  };
  return problemsOf(compare(contract, options)).filter(
    (problem) =>
      typeof problem === 'object' && problem !== null && Reflect.get(problem, 'model') === 'Probe',
  );
}

describe('a column type that only a TypeScript contract can declare', () => {
  it('is checked by the kind of value its codec reads: a Postgres varchar is a string, not a date', () => {
    expect(probeProblems({ type: 'string' })).toEqual([]);
    expect(probeProblems({ type: 'date' })).toEqual([
      {
        kind: 'wrong-type',
        model: 'Probe',
        field: 'value',
        expectedType: 'DateTime',
        found: 'pg/varchar@1',
      },
    ]);
  });
});
