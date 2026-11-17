import { generateContractDts } from '@internal/emitter';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

/**
 * FK1: a persisted `foreignKeys[]` entry is source + target + `onDelete`/
 * `onUpdate` only — the `constraint`/`index` authoring booleans never reach
 * `contract.json` or `contract.d.ts`. A backing index (if any) is its own
 * discrete, named `indexes[]` entry.
 */
describe('generateContractDts — FK literal (FK1)', () => {
  it('renders the FK literal with source/target only, no constraint or index fields', () => {
    const ir = createContract({
      models: {},
      storage: {
        tables: {
          user: {
            columns: { id: { dataType: 'pg/int4', codecId: 'sql/int@1', nullable: false } },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'sql/int@1', nullable: false },
              userId: { dataType: 'pg/int4', codecId: 'sql/int@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [{ columns: ['userId'], name: 'post_userId_idx', unique: false }],
            foreignKeys: [
              {
                source: { namespaceId: '__unbound__', tableName: 'post', columns: ['userId'] },
                target: { namespaceId: '__unbound__', tableName: 'user', columns: ['id'] },
              },
            ],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);

    expect(types).toContain('readonly tableName: "post"; readonly columns: readonly ["userId"]');
    expect(types).toContain('readonly tableName: "user"; readonly columns: readonly ["id"]');
    expect(types).toContain(
      'indexes: readonly [{ readonly name: "post_userId_idx"; readonly columns: readonly ["userId"]; readonly unique: false }]',
    );

    // No leftover `constraint`/`index` fields anywhere near a foreign key.
    const fkLiteralStart = types.indexOf('foreignKeys: readonly [');
    const fkLiteralEnd = types.indexOf('}]', fkLiteralStart) + 2;
    const fkLiteral = types.slice(fkLiteralStart, fkLiteralEnd);
    expect(fkLiteral).not.toContain('constraint');
    expect(fkLiteral).not.toContain('readonly index');
  });

  it('renders a named FK with no constraint or index fields', () => {
    const ir = createContract({
      models: {},
      storage: {
        tables: {
          user: {
            columns: { id: { dataType: 'pg/int4', codecId: 'sql/int@1', nullable: false } },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'sql/int@1', nullable: false },
              userId: { dataType: 'pg/int4', codecId: 'sql/int@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                source: { namespaceId: '__unbound__', tableName: 'post', columns: ['userId'] },
                target: { namespaceId: '__unbound__', tableName: 'user', columns: ['id'] },
                name: 'post_userId_fkey',
                onDelete: 'cascade',
              },
            ],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);

    expect(types).toContain('readonly name: "post_userId_fkey"');
    const fkLiteralStart = types.indexOf('readonly foreignKeys:');
    const fkLiteralEnd = types.indexOf('}]', fkLiteralStart) + 2;
    const fkLiteral = types.slice(fkLiteralStart, fkLiteralEnd);
    expect(fkLiteral).not.toContain('constraint');
    expect(fkLiteral).not.toContain('readonly index');
  });
});
