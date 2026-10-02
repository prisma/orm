import { type Contract, profileHash, type StorageHashBase } from '@internal/contract/types';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumn, type StorageTable } from '@internal/sql-contract/types';
import { isStructuredError } from '@internal/utils/structured-error';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../1-core/contract/test/test-type-lookups';
import { contractToSchemaIR } from '../src/core/migrations/contract-to-schema-ir';

function captureError(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

function wrap(storage: SqlStorage): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage,
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function table(columns: Record<string, StorageColumn>): StorageTable {
  return { columns, uniques: [], indexes: [], foreignKeys: [] };
}

const types = {
  dataTypeLookup: testTypeLookups.dataTypeLookup,
  codecLookup: testTypeLookups.codecLookup,
};

const intColumn: StorageColumn = { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false };

describe('contract-to-schema-ir structured error codes', () => {
  it('raises CONTRACT.TYPE_UNKNOWN for a column typeRef missing from storage.types', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: { widget: table({ size: { ...intColumn, typeRef: 'missing_type' } }) },
          },
        }),
      },
    });

    const error = captureError(() =>
      contractToSchemaIR(wrap(storage), { annotationNamespace: 'pg', ...types }),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.TYPE_UNKNOWN',
      meta: { typeRef: 'missing_type' },
    });
  });

  it('names the table and column whose codec is not registered', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: { widget: table({ size: { ...intColumn, codecId: 'app/unknown@1' } }) },
          },
        }),
      },
    });

    const codecLookup: CodecLookupWithDescriptors = {
      ...testTypeLookups.codecLookup,
      descriptorFor: (codecId) =>
        codecId === 'app/unknown@1'
          ? undefined
          : testTypeLookups.codecLookup.descriptorFor(codecId),
    };
    const error = captureError(() =>
      contractToSchemaIR(wrap(storage), { annotationNamespace: 'pg', ...types, codecLookup }),
    );
    expect(error).toMatchObject({
      code: 'CONTRACT.CODEC_DESCRIPTOR_MISSING',
      meta: { codecId: 'app/unknown@1', table: 'widget', column: 'size' },
      fix: expect.stringContaining('pack that provides the codec'),
    });
  });

  it('raises CONTRACT.TABLE_AMBIGUOUS for a duplicate table name across namespaces', () => {
    const storage = new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        ns_one: createTestSqlNamespace({
          id: 'ns_one',
          entries: { table: { user: table({ id: intColumn }) } },
        }),
        ns_two: createTestSqlNamespace({
          id: 'ns_two',
          entries: { table: { user: table({ id: intColumn }) } },
        }),
      },
    });

    const error = captureError(() =>
      contractToSchemaIR(wrap(storage), { annotationNamespace: 'pg', ...types }),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.TABLE_AMBIGUOUS',
      meta: { table: 'user' },
    });
  });

  it('raises CONTRACT.PACK_CONTRIBUTION_INVALID for an empty annotationNamespace', () => {
    const error = captureError(() =>
      contractToSchemaIR(null, { annotationNamespace: '', ...types }),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
      message: 'annotationNamespace must be a non-empty string',
    });
  });
});
