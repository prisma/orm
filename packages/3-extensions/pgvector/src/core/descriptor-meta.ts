import {
  buildOperation,
  type CodecExpression,
  codecOf,
  type Expression,
  toExpr,
} from '@internal/sql-relational-core/expression';
import type { CodecTypes, ParameterizedOutputTypesForTypeParams } from '../types/codec-types';
import type { QueryOperationTypes, QueryOperationTypesForCodecs } from '../types/operation-types';
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
      parameterizedOutputTypes: {
        package: '@internal/extension-pgvector/codec-types',
        named: 'ParameterizedOutputTypesForTypeParams',
        alias: 'PgVectorParameterizedOutputTypes',
      },
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
  },
} as const;

export const pgvectorPackMeta: typeof pgvectorPackMetaBase & {
  readonly __codecTypes?: CodecTypes;
  readonly __queryOperationTypes?: QueryOperationTypesForCodecs;
  readonly __parameterizedOutputTypes?: ParameterizedOutputTypesForTypeParams;
} = pgvectorPackMetaBase;
