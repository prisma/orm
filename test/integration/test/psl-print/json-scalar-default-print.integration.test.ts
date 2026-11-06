import type { Contract } from '@internal/contract/types';
import { mapDefault } from '@internal/family-sql/psl-build';
import { dataTypeId } from '@internal/framework-components/codec';
import type { SqlStorage, StorageColumn } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { sqliteContractFromPsl, sqliteStack } from '../date-time-defaults/sqlite-authoring';
import { printAndReadBack, printContract, readPsl } from './print-and-read-back';

/** The backtick fencing a tagged literal, as an escape so no quoted string in this file holds one. */
const BACKTICK = '`';
const json = (body: string) => `json${BACKTICK}${body}${BACKTICK}`;

const FIELDS = `  count   Json @default(${json('42')})
  flag    Json @default(${json('true')})
  nothing Json? @default(${json('null')})`;

function defaults(printed: string): Record<string, string> {
  return Object.fromEntries(
    printed.split('\n').flatMap((line) => {
      const match = /^\s+(\w+)\s+\S+\s+.*@default\((.*)\)\s*$/.exec(line);
      return match?.[1] === undefined || match[2] === undefined ? [] : [[match[1], match[2]]];
    }),
  );
}

function columnsOf(contract: Contract<SqlStorage>): Readonly<Record<string, StorageColumn>> {
  const namespace = Object.values(contract.storage.namespaces)[0];
  return namespace?.entries['table']?.['Doc']?.columns ?? {};
}

describe('a JSON document that is a number, a boolean or null', () => {
  it('is printed with the json tag on Postgres, and reads back as the same contract', async () => {
    const contract = await readPsl(`// use prisma-8

model Doc {
  id      Int  @id
${FIELDS}
}
`);
    expect(defaults(printContract(contract).text)).toMatchObject({
      count: json('42'),
      flag: json('true'),
      nothing: json('null'),
    });
    expect(await printAndReadBack(contract)).toEqual(contract);
  });

  it('is written with the json tag on SQLite, and the literal reads back as the stored default', async () => {
    const contract = await sqliteContractFromPsl(`model Doc {
  id      Int  @id
${FIELDS}
}`);
    const printed = Object.fromEntries(
      Object.entries(columnsOf(contract)).flatMap(([name, column]) => {
        if (column.default?.kind !== 'literal') return [];
        const attribute = mapDefault(column.default, {
          dataTypes: sqliteStack.dataTypes,
          columnCodec: { dataType: dataTypeId(column.dataType) },
        })?.attribute;
        return [[name, attribute]];
      }),
    );
    expect(printed).toEqual({
      count: `@default(${json('42')})`,
      flag: `@default(${json('true')})`,
      nothing: `@default(${json('null')})`,
    });

    const reread = await sqliteContractFromPsl(`model Doc {
  id      Int  @id
  count   Json ${printed['count']}
  flag    Json ${printed['flag']}
  nothing Json? ${printed['nothing']}
}`);
    expect(columnsOf(reread)).toEqual(columnsOf(contract));
  });
});
