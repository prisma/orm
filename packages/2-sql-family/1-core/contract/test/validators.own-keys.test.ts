import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { col, model, pk, table } from '../src/factories';
import type { SqlStorage } from '../src/types';
import { validateSqlContractFully } from '../src/validators';

const storage = {
  namespaces: {
    [UNBOUND_NAMESPACE_ID]: {
      id: UNBOUND_NAMESPACE_ID,
      kind: 'test-sql-namespace',
      entries: {
        table: {
          user: table({ id: col('pg/int4', 'pg/int4@1') }, { pk: pk('id') }),
          user_tag: table(
            { user_id: col('pg/int4', 'pg/int4@1'), tag_id: col('pg/int4', 'pg/int4@1') },
            { pk: pk('user_id', 'tag_id') },
          ),
          tag: table({ id: col('pg/int4', 'pg/int4@1') }, { pk: pk('id') }),
        },
      },
    },
  },
};

function refusalOf(models: Record<string, unknown>): string {
  try {
    validateSqlContractFully(createContract<SqlStorage>({ storage, models: models as never }));
  } catch (error) {
    return String(error);
  }
  return 'accepted';
}

function sameAsFor(name: string, other: string, models: (name: string) => Record<string, unknown>) {
  expect(refusalOf(models(name)).replaceAll(name, '<name>')).toEqual(
    refusalOf(models(other)).replaceAll(other, '<name>'),
  );
}

describe('validateSqlContractFully, names every object has as a property', () => {
  it('treats a model stored in a missing table named constructor as any missing table', () => {
    sameAsFor('constructor', 'ghost', (name) => ({
      User: model(name, { id: { column: 'id' } }),
    }));
  });
});
