import { buildOperation, codecOf, toExpr } from '@internal/sql-relational-core/expression';
import type { CodecTypes } from '../types/codec-types';
import type { QueryOperationTypes } from '../types/operation-types';
import { postgisAuthoringTypes } from './authoring';
import { postgisDataTypes } from './data-types';
import { postgisCodecRegistry } from './registry';

const postgisTypeId = 'pg/geometry@1' as const;

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

/**
 * Build the PostGIS query operations exposed on `geometry` columns.
 *
 * Each operation lowers to a function-template that the SQL renderer
 * stitches into the surrounding statement (`{{self}}` is the receiver,
 * `{{argN}}` are the call arguments). All templates rely on the implicit
 * `geometry`/`float8`/`bool` casts already wired up by the SQL family —
 * we only add the PostGIS-specific function names.
 */
export function postgisQueryOperations<CT extends CodecTypesBase>(): QueryOperationTypes<CT> {
  return {
    distance: {
      self: { codecId: postgisTypeId },
      impl: (self, other) => {
        const selfCodec = codecOf(self);
        return buildOperation({
          method: 'distance',
          args: [toExpr(self, selfCodec), toExpr(other, selfCodec)],
          returns: { codecId: 'pg/float8@1', nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: 'ST_Distance({{self}}, {{arg0}})',
          },
        });
      },
    },
    distanceSphere: {
      self: { codecId: postgisTypeId },
      impl: (self, other) => {
        const selfCodec = codecOf(self);
        return buildOperation({
          method: 'distanceSphere',
          args: [toExpr(self, selfCodec), toExpr(other, selfCodec)],
          returns: { codecId: 'pg/float8@1', nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: 'ST_DistanceSphere({{self}}, {{arg0}})',
          },
        });
      },
    },
    dwithin: {
      self: { codecId: postgisTypeId },
      impl: (self, other, distance) => {
        const selfCodec = codecOf(self);
        return buildOperation({
          method: 'dwithin',
          args: [
            toExpr(self, selfCodec),
            toExpr(other, selfCodec),
            toExpr(distance, { codecId: 'pg/float8@1' }),
          ],
          returns: { codecId: 'pg/bool@1', nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: 'ST_DWithin({{self}}, {{arg0}}, {{arg1}})',
          },
        });
      },
    },
    contains: {
      self: { codecId: postgisTypeId },
      impl: (self, other) => {
        const selfCodec = codecOf(self);
        return buildOperation({
          method: 'contains',
          args: [toExpr(self, selfCodec), toExpr(other, selfCodec)],
          returns: { codecId: 'pg/bool@1', nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: 'ST_Contains({{self}}, {{arg0}})',
          },
        });
      },
    },
    within: {
      self: { codecId: postgisTypeId },
      impl: (self, other) => {
        const selfCodec = codecOf(self);
        return buildOperation({
          method: 'within',
          args: [toExpr(self, selfCodec), toExpr(other, selfCodec)],
          returns: { codecId: 'pg/bool@1', nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: 'ST_Within({{self}}, {{arg0}})',
          },
        });
      },
    },
    intersects: {
      self: { codecId: postgisTypeId },
      impl: (self, other) => {
        const selfCodec = codecOf(self);
        return buildOperation({
          method: 'intersects',
          args: [toExpr(self, selfCodec), toExpr(other, selfCodec)],
          returns: { codecId: 'pg/bool@1', nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: 'ST_Intersects({{self}}, {{arg0}})',
          },
        });
      },
    },
    intersectsBbox: {
      self: { codecId: postgisTypeId },
      impl: (self, other) => {
        const selfCodec = codecOf(self);
        return buildOperation({
          method: 'intersectsBbox',
          args: [toExpr(self, selfCodec), toExpr(other, selfCodec)],
          returns: { codecId: 'pg/bool@1', nullable: false },
          lowering: {
            targetFamily: 'sql',
            strategy: 'function',
            template: '({{self}} && {{arg0}})',
          },
        });
      },
    },
  };
}

const postgisPackMetaBase = {
  kind: 'extension',
  id: 'postgis',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  capabilities: {
    postgres: {
      'postgis.geometry': true,
    },
  },
  authoring: {
    type: postgisAuthoringTypes,
  },
  dataTypes: postgisDataTypes,
  types: {
    codecTypes: {
      codecDescriptors: Array.from(postgisCodecRegistry.values()),
      import: {
        package: '@internal/extension-postgis/codec-types',
        named: 'CodecTypes',
        alias: 'PostgisTypes',
      },
      typeImports: [
        {
          package: '@internal/extension-postgis/codec-types',
          named: 'Geometry',
          alias: 'Geometry',
        },
      ],
    },
    queryOperationTypes: {
      import: {
        package: '@internal/extension-postgis/operation-types',
        named: 'QueryOperationTypes',
        alias: 'PostgisQueryOperationTypes',
      },
    },
    storage: [
      { typeId: postgisTypeId, familyId: 'sql', targetId: 'postgres', nativeType: 'geometry' },
    ],
  },
} as const;

export const postgisPackMeta: typeof postgisPackMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = postgisPackMetaBase;
