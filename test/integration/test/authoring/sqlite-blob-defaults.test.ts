import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { authorSqliteContractFromPsl } from '../date-time-defaults/sqlite-authoring';

async function author(attribute: string) {
  const result = await authorSqliteContractFromPsl(
    `model Event {\n  id Int @id\n  payload Bytes ${attribute}\n}`,
  );
  if (!result.ok) {
    return {
      diagnostics: result.failure.diagnostics.map(({ code, message }) => ({ code, message })),
    };
  }
  const contract = result.value as Contract<SqlStorage>;
  const columns = contract.storage.namespaces['__unbound__']?.entries['table']?.['Event']?.columns;
  return { payload: columns?.['payload'] };
}

describe('a SQLite Bytes default', () => {
  it('is written with the blob tag and stored as upper-case hex', async () => {
    expect(await author('@default(blob`68656c6c6f`)')).toMatchObject({
      payload: { default: { kind: 'literal', value: '68656C6C6F' } },
    });
  });

  it('refuses a quoted string, naming the blob tag', async () => {
    expect(await author('@default("68656c6c6f")')).toEqual({
      diagnostics: [
        {
          code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
          message: expect.stringContaining('Expected blob`...`'),
        },
      ],
    });
  });
});
