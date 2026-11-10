import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  DropSchemaCall,
  RenameSchemaCall,
  SetTableSchemaCall,
} from '@internal/target-postgres/op-factory-call';
import { describe, expect, it } from 'vitest';
import { controlAdapter } from './fixtures/runner-fixtures';

async function executeSql(call: {
  toOp(lowerer: typeof controlAdapter): Promise<{ execute: readonly { sql: string }[] }>;
}): Promise<readonly string[]> {
  const op = await call.toOp(controlAdapter);
  return op.execute.map((step) => step.sql);
}

describe('schema operation DDL rendering', () => {
  it('moves a table with ALTER TABLE … SET SCHEMA, unqualified for the unbound namespace', async () => {
    expect(await executeSql(new SetTableSchemaCall('billing', 'invoice', 'finance'))).toEqual([
      'ALTER TABLE "billing"."invoice" SET SCHEMA "finance"',
    ]);
    expect(
      await executeSql(new SetTableSchemaCall(UNBOUND_NAMESPACE_ID, 'invoice', 'billing')),
    ).toEqual(['ALTER TABLE "invoice" SET SCHEMA "billing"']);
  });

  it('renames a schema with ALTER SCHEMA … RENAME TO', async () => {
    expect(await executeSql(new RenameSchemaCall('billing', 'finance'))).toEqual([
      'ALTER SCHEMA "billing" RENAME TO "finance"',
    ]);
  });

  it('drops a schema without CASCADE', async () => {
    expect(await executeSql(new DropSchemaCall('billing'))).toEqual(['DROP SCHEMA "billing"']);
  });

  it('quotes names that need it', async () => {
    expect(await executeSql(new RenameSchemaCall('Bill"ing', 'fin ance'))).toEqual([
      'ALTER SCHEMA "Bill""ing" RENAME TO "fin ance"',
    ]);
  });
});
