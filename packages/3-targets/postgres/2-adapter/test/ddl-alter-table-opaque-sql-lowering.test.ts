import { checkExpression } from '@internal/sql-relational-core/contract-free';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import {
  addConstraintAction,
  alterColumnTypeAction,
  alterTable,
} from '@internal/target-postgres/contract-free';
import {
  createPostgresBuiltinDataTypeLookup,
  postgresDataTypes,
} from '@internal/target-postgres/data-types';
import {
  AddCheckConstraintCall,
  AlterColumnTypeCall,
} from '@internal/target-postgres/op-factory-call';
import { describe, expect, it } from 'vitest';
import { createTestPostgresControlAdapter } from './helpers/test-control-adapter';

const adapter = createTestPostgresControlAdapter(
  createPostgresBuiltinCodecLookup(),
  createPostgresBuiltinDataTypeLookup(),
);

async function lowerSql(
  schema: string | undefined,
  action: Parameters<typeof alterTable>[0]['actions'][number],
): Promise<string> {
  const lowered = await adapter.lowerToExecuteRequest(
    alterTable({ ...(schema === undefined ? {} : { schema }), table: 't', actions: [action] }),
  );
  expect(lowered.params).toEqual([]);
  return lowered.sql;
}

describe('PostgresAlterTable ADD CONSTRAINT lowering', () => {
  const addCheck = (expression: string) =>
    addConstraintAction(checkExpression('c_chk', expression));

  it('writes a CHECK constraint as CREATE TABLE writes it', async () => {
    expect([
      await lowerSql('public', addCheck('"a" > 0')),
      await lowerSql(undefined, addCheck('"a" > 0')),
    ]).toEqual([
      'ALTER TABLE "public"."t" ADD CONSTRAINT "c_chk" CHECK ("a" > 0)',
      'ALTER TABLE "t" ADD CONSTRAINT "c_chk" CHECK ("a" > 0)',
    ]);
  });

  it('ends an expression holding a line comment with a line break before the closing parenthesis', async () => {
    expect([
      await lowerSql('public', addCheck('"a" > 0 -- positive')),
      await lowerSql('public', addCheck('"a" > 0\n  AND "b" > 0 -- both')),
      await lowerSql('public', addCheck('"a" -- x\n > 0')),
    ]).toEqual([
      'ALTER TABLE "public"."t" ADD CONSTRAINT "c_chk" CHECK ("a" > 0 -- positive\n)',
      'ALTER TABLE "public"."t" ADD CONSTRAINT "c_chk" CHECK ("a" > 0\n  AND "b" > 0 -- both\n)',
      'ALTER TABLE "public"."t" ADD CONSTRAINT "c_chk" CHECK ("a" -- x\n > 0\n)',
    ]);
  });
});

describe('PostgresAlterTable ALTER COLUMN TYPE lowering', () => {
  const alterType = (using?: string) =>
    alterColumnTypeAction({
      columnName: 'a',
      type: 'int8',
      ...(using === undefined ? {} : { using }),
    });

  it('casts the column to the new type when there is no USING text', async () => {
    expect([await lowerSql('public', alterType()), await lowerSql(undefined, alterType())]).toEqual(
      [
        'ALTER TABLE "public"."t" ALTER COLUMN "a" TYPE int8 USING "a"::int8',
        'ALTER TABLE "t" ALTER COLUMN "a" TYPE int8 USING "a"::int8',
      ],
    );
  });

  it('writes the USING text as given', async () => {
    expect(await lowerSql('public', alterType('trim("a")::int8'))).toBe(
      'ALTER TABLE "public"."t" ALTER COLUMN "a" TYPE int8 USING trim("a")::int8',
    );
  });

  it('treats an empty USING text as no USING text', async () => {
    expect(await lowerSql('public', alterType(''))).toBe(
      'ALTER TABLE "public"."t" ALTER COLUMN "a" TYPE int8 USING "a"::int8',
    );
  });

  it('ends USING text holding a line comment with a line break', async () => {
    expect([
      await lowerSql('public', alterType('"a"::int8 -- widen')),
      await lowerSql(undefined, alterType('"a"\n::int8 -- c')),
    ]).toEqual([
      'ALTER TABLE "public"."t" ALTER COLUMN "a" TYPE int8 USING "a"::int8 -- widen\n',
      'ALTER TABLE "t" ALTER COLUMN "a" TYPE int8 USING "a"\n::int8 -- c\n',
    ]);
  });
});

describe('migration operations that write opaque SQL into ALTER TABLE', () => {
  it('addCheckConstraint writes the ADD CONSTRAINT statement', async () => {
    const op = await new AddCheckConstraintCall(
      'public',
      'post',
      'post_priority_check',
      `"priority" IN ('low', 'high')`,
    ).toOp(adapter);
    expect(op.execute).toEqual([
      {
        description: 'add check constraint "post_priority_check"',
        sql: `ALTER TABLE "public"."post" ADD CONSTRAINT "post_priority_check" CHECK ("priority" IN ('low', 'high'))`,
      },
    ]);
  });

  it('alterColumnType writes the ALTER COLUMN TYPE statement, with or without USING text', async () => {
    const sqlOf = async (using?: string) =>
      (
        await new AlterColumnTypeCall({
          ownsAutoincrementSequence: false,
          schemaName: 'public',
          tableName: 'user',
          columnName: 'age',
          type: 'int8',
          dataTypes: postgresDataTypes,
          ...(using === undefined ? {} : { using: { kind: 'sql', sql: using } }),
        }).toOp(adapter)
      ).execute[0]?.sql;
    expect([
      await sqlOf(),
      await sqlOf(''),
      await sqlOf('age::int8 * 2'),
      await sqlOf(`nullif("age", ';')::int8`),
    ]).toEqual([
      'ALTER TABLE "public"."user" ALTER COLUMN "age" TYPE int8 USING "age"::int8',
      'ALTER TABLE "public"."user" ALTER COLUMN "age" TYPE int8 USING "age"::int8',
      'ALTER TABLE "public"."user" ALTER COLUMN "age" TYPE int8 USING age::int8 * 2',
      `ALTER TABLE "public"."user" ALTER COLUMN "age" TYPE int8 USING nullif("age", ';')::int8`,
    ]);
  });

  it('refuses an empty schema name when the migration is planned', async () => {
    const alterType = new AlterColumnTypeCall({
      ownsAutoincrementSequence: false,
      schemaName: '',
      tableName: 'user',
      columnName: 'age',
      type: 'int8',
      dataTypes: postgresDataTypes,
    });
    const addCheck = new AddCheckConstraintCall(
      '',
      'post',
      'post_priority_check',
      '"priority" > 0',
    );
    await expect(alterType.toOp(adapter)).rejects.toMatchObject({
      code: 'CONTRACT.IDENTIFIER_INVALID',
    });
    await expect(addCheck.toOp(adapter)).rejects.toMatchObject({
      code: 'CONTRACT.IDENTIFIER_INVALID',
    });
  });
});
