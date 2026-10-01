import type { OpFactoryCall } from '@internal/framework-components/control';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import {
  DisableRowLevelSecurityCall,
  DropCheckConstraintCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropIndexCall,
  DropNativeEnumTypeCall,
  DropPostgresRlsPolicyCall,
  DropTableCall,
} from '@internal/target-postgres/op-factory-call';
import { renderOps } from '@internal/target-postgres/render-ops';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());

async function classes(call: OpFactoryCall) {
  const [op] = await Promise.all(renderOps([call], adapter));
  return { call: call.operationClass, op: op?.operationClass };
}

describe('drops that lose no stored data', () => {
  it.each([
    ['an index', new DropIndexCall('public', 'user', 'user_email_idx')],
    ['a unique constraint', new DropConstraintCall('public', 'user', 'user_email_key')],
    ['a foreign key', new DropConstraintCall('public', 'post', 'post_user_fk', 'foreignKey')],
    ['a primary key', new DropConstraintCall('public', 'user', 'user_pkey', 'primaryKey')],
    ['a check constraint', new DropCheckConstraintCall('public', 'user', 'user_age_check')],
    ['a row-level-security policy', new DropPostgresRlsPolicyCall('public', 'user', 'own_rows')],
    ['a column default', new DropDefaultCall('public', 'user', 'created_at')],
    ['a native enum type', new DropNativeEnumTypeCall('public', 'role')],
    ['row-level security', new DisableRowLevelSecurityCall('public', 'user')],
  ])('dropping %s is widening', async (_label, call) => {
    expect(await classes(call)).toEqual({ call: 'widening', op: 'widening' });
  });
});

describe('drops that lose stored data', () => {
  it.each([
    ['a table', new DropTableCall('public', 'user')],
    ['a column', new DropColumnCall('public', 'user', 'email')],
  ])('dropping %s stays destructive', async (_label, call) => {
    expect(await classes(call)).toEqual({ call: 'destructive', op: 'destructive' });
  });
});
