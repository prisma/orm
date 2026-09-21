import {
  buildOperation,
  type CodecExpression,
  codecOf,
  type Expression,
  toExpr,
} from '@internal/sql-relational-core/expression';
import type { CodecTypes } from '../types/codec-types';
import type { QueryOperationTypes } from '../types/operation-types';
import { pgvectorAuthoringTypes } from './authoring';
import { pgvectorDataTypes } from './data-types';
import { pgvectorCodecRegistry } from './registry';

const pgvectorTypeId = 'pg/vector@1' as const;

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

export function pgvectorQueryOperations<CT extends CodecTypesBase>(): QueryOperationTypes<CT> {
  return {
    cosineDistance: {
      self: { codecId: pgvectorTypeId },
      impl: (
        self: CodecExpression<'pg/vector@1', boolean, CT>,
        other: CodecExpression<'pg/vector@1', boolean, CT>,
      ): Expression<{ codecId: 'pg/float8@1'; nullable: false }> => {
        const selfCodec = codecOf(self);
        return buildOperation({
          method: 'cosineDistance',
          args: [toExpr(self, selfCodec), toExpr(other, selfCodec)],
          returns: { codecId: 'pg/float8@1', nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: '{{self}} <=> {{arg0}}',
          },
        });
      },
    },
    cosineSimilarity: {
      self: { codecId: pgvectorTypeId },
      impl: (
        self: CodecExpression<'pg/vector@1', boolean, CT>,
        other: CodecExpression<'pg/vector@1', boolean, CT>,
      ): Expression<{ codecId: 'pg/float8@1'; nullable: false }> => {
        const selfCodec = codecOf(self);
        return buildOperation({
          method: 'cosineSimilarity',
          args: [toExpr(self, selfCodec), toExpr(other, selfCodec)],
          returns: { codecId: 'pg/float8@1', nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: '1 - ({{self}} <=> {{arg0}})',
          },
        });
      },
    },
  };
}

const pgvectorPackMetaBase = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  capabilities: {
    postgres: {
      'pgvector.cosine': true,
    },
  },
  authoring: {
    type: pgvectorAuthoringTypes,
  },
  dataTypes: pgvectorDataTypes,
  types: {
    codecTypes: {
      codecDescriptors: Array.from(pgvectorCodecRegistry.values()),
      import: {
        package: '@internal/extension-pgvector/codec-types',
        named: 'CodecTypes',
        alias: 'PgVectorTypes',
      },
      typeImports: [
        {
          package: '@internal/extension-pgvector/codec-types',
          named: 'Vector',
          alias: 'Vector',
        },
      ],
    },
    operationTypes: {
      import: {
        package: '@internal/extension-pgvector/operation-types',
        named: 'OperationTypes',
        alias: 'PgVectorOperationTypes',
      },
    },
    queryOperationTypes: {
      import: {
        package: '@internal/extension-pgvector/operation-types',
        named: 'QueryOperationTypes',
        alias: 'PgVectorQueryOperationTypes',
      },
    },
    storage: [
      { typeId: pgvectorTypeId, familyId: 'sql', targetId: 'postgres', nativeType: 'vector' },
    ],
  },
} as const;

export const pgvectorPackMeta: typeof pgvectorPackMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = pgvectorPackMetaBase;
