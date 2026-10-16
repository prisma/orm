import { type Contract, profileHash, type StorageHashBase } from '@internal/contract/types';
import type {
  AnyCodecDescriptor,
  CodecLookupWithDescriptors,
} from '@internal/framework-components/codec';
import { createDataTypeLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { SqlStorage } from '@internal/sql-contract/types';
import { SqlColumnDefaultIR } from '@internal/sql-schema-ir/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { contractToSchemaIR } from '../src/core/migrations/contract-to-schema-ir';

const textType = sqlDataType('test/text', { texts: [{ text: 'text', written: true }] });

const codecLookup: CodecLookupWithDescriptors = {
  ...emptyCodecLookup,
  descriptorFor: (id) =>
    id === 'pg/text@1' ? ({ codecId: id, dataType: textType.id } as AnyCodecDescriptor) : undefined,
};

function contractWithDefault(expression: string): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: 'test' as StorageHashBase<string>,
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              T: {
                columns: {
                  label: {
                    codecId: 'pg/text@1',
                    dataType: textType.id,
                    nullable: false,
                    many: false,
                    default: { kind: 'function', expression },
                  },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        }),
      },
    }),
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function declaredDefault(expression: string): SqlColumnDefaultIR {
  const column = contractToSchemaIR(contractWithDefault(expression), {
    annotationNamespace: 'pg',
    dataTypeLookup: createDataTypeLookup([textType]),
    codecLookup,
  }).tables['T']?.columns['label'];
  const [node] = column?.children() ?? [];
  if (node === undefined || !(node instanceof SqlColumnDefaultIR)) {
    throw new Error('the column has no default node');
  }
  return node;
}

describe('the sql literal a contract-derived default writes a SQL text with', () => {
  it('writes a text that reads back', () => {
    expect(declaredDefault('now()').sqlExpressionLiteralFor?.("lower('a`b')")).toBe(
      `sql"lower('a\`b')"`,
    );
  });

  it('writes none for a text no literal reads back as, rather than throwing', () => {
    expect(
      declaredDefault('now()').sqlExpressionLiteralFor?.('\nCASE\n  WHEN true THEN now()\nEND'),
    ).toBeUndefined();
  });

  it('explains a multi-line default the database stores with a leading line break', () => {
    const stored = new SqlColumnDefaultIR({
      resolved: {
        kind: 'function',
        expression: "CASE\n    WHEN true THEN 'a'::text\n    ELSE 'b'::text\nEND",
      },
      raw: "\nCASE\n    WHEN true THEN 'a'::text\n    ELSE 'b'::text\nEND",
    });
    expect(
      declaredDefault("CASE WHEN true THEN 'a' ELSE 'b' END").explainMismatch(stored)?.text,
    ).toContain(
      "If they do, write the default as sql`\nCASE\n    WHEN true THEN 'a'::text\n    ELSE 'b'::text\nEND\n`.",
    );
  });
});
