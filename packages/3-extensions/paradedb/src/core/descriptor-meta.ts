import { LiteralExpr } from '@internal/sql-relational-core/ast';
import { buildOperation, toExpr } from '@internal/sql-relational-core/expression';
import { paradedbIndexTypes } from '../types/index-types';
import type { QueryOperationTypes } from '../types/operation-types';
import { PARADEDB_EXTENSION_ID } from './constants';
import { paradeDbError } from './errors';
import { ParadeDbProximityChain } from './proximity-chain';

type CodecTypesBase = Record<string, { readonly input: unknown; readonly output: unknown }>;

const TEXT = 'pg/text@1' as const;
const BOOL = 'pg/bool@1' as const;
const FLOAT4 = 'pg/float4@1' as const;
const INT4 = 'pg/int4@1' as const;

const TEXT_REF = { codecId: TEXT } as const;
const INT4_REF = { codecId: INT4 } as const;

export function paradedbQueryOperations<CT extends CodecTypesBase>(): QueryOperationTypes<CT> {
  return {
    // `@@@` accepts both text and structured query types on its RHS.
    // https://docs.paradedb.com/documentation/full-text/match
    paradeDbMatch: {
      self: { codecId: TEXT },
      impl: (self, query) =>
        buildOperation({
          method: 'paradeDbMatch',
          args: [toExpr(self, TEXT_REF), toExpr(query, TEXT_REF)],
          returns: { codecId: BOOL, nullable: false },
          lowering: {
            targetFamily: 'sql',
            template: '{{self}} @@@ {{arg0}}',
          },
        }),
    },
    paradeDbMatchAny: {
      self: { codecId: TEXT },
      impl: (self, query) =>
        buildOperation({
          method: 'paradeDbMatchAny',
          args: [toExpr(self, TEXT_REF), toExpr(query, TEXT_REF)],
          returns: { codecId: BOOL, nullable: false },
          lowering: {
            targetFamily: 'sql',
            template: '{{self}} ||| {{arg0}}',
          },
        }),
    },
    paradeDbMatchAll: {
      self: { codecId: TEXT },
      impl: (self, query) =>
        buildOperation({
          method: 'paradeDbMatchAll',
          args: [toExpr(self, TEXT_REF), toExpr(query, TEXT_REF)],
          returns: { codecId: BOOL, nullable: false },
          lowering: {
            targetFamily: 'sql',
            template: '{{self}} &&& {{arg0}}',
          },
        }),
    },
    // https://docs.paradedb.com/documentation/full-text/term
    paradeDbTerm: {
      self: { codecId: TEXT },
      impl: (self, query) =>
        buildOperation({
          method: 'paradeDbTerm',
          args: [toExpr(self, TEXT_REF), toExpr(query, TEXT_REF)],
          returns: { codecId: BOOL, nullable: false },
          lowering: {
            targetFamily: 'sql',
            template: '{{self}} === {{arg0}}',
          },
        }),
    },
    // https://docs.paradedb.com/documentation/full-text/phrase
    paradeDbPhrase: {
      self: { codecId: TEXT },
      impl: (self, query) =>
        buildOperation({
          method: 'paradeDbPhrase',
          args: [toExpr(self, TEXT_REF), toExpr(query, TEXT_REF)],
          returns: { codecId: BOOL, nullable: false },
          lowering: {
            targetFamily: 'sql',
            template: '{{self}} ### {{arg0}}',
          },
        }),
    },
    // https://docs.paradedb.com/documentation/sorting/score
    paradeDbScore: {
      self: { codecId: INT4 },
      impl: (self) =>
        buildOperation({
          method: 'paradeDbScore',
          args: [toExpr(self, INT4_REF)],
          returns: { codecId: FLOAT4, nullable: false },
          lowering: {
            targetFamily: 'sql',
            template: 'pdb.score({{self}})',
          },
        }),
    },
    // PG rejects parameterized typmods, so the cast argument lowers to a literal.
    // https://docs.paradedb.com/documentation/full-text/fuzzy
    paradeDbFuzzy: {
      self: { codecId: TEXT },
      impl: (self, distance) => {
        if (!Number.isInteger(distance) || distance < 0 || distance > 2) {
          throw paradeDbError(
            'PARADEDB.ARGUMENT_INVALID',
            `paradeDbFuzzy: distance must be an integer in [0, 2]; got ${String(distance)}`,
            { meta: { helper: 'paradeDbFuzzy', argument: 'distance', received: distance } },
          );
        }
        return buildOperation({
          method: 'paradeDbFuzzy',
          args: [toExpr(self, TEXT_REF), LiteralExpr.of(distance)],
          returns: { codecId: TEXT, nullable: false },
          lowering: {
            targetFamily: 'sql',
            template: '{{self}}::pdb.fuzzy({{arg0}})',
          },
        });
      },
    },
    // https://docs.paradedb.com/documentation/sorting/boost
    paradeDbBoost: {
      self: { codecId: TEXT },
      impl: (self, weight) => {
        if (!Number.isInteger(weight) || weight < -2048 || weight > 2048) {
          throw paradeDbError(
            'PARADEDB.ARGUMENT_INVALID',
            `paradeDbBoost: boost must be an integer in [-2048, 2048]; got ${String(weight)}`,
            { meta: { helper: 'paradeDbBoost', argument: 'weight', received: weight } },
          );
        }
        return buildOperation({
          method: 'paradeDbBoost',
          args: [toExpr(self, TEXT_REF), LiteralExpr.of(weight)],
          returns: { codecId: TEXT, nullable: false },
          lowering: {
            targetFamily: 'sql',
            template: '{{self}}::pdb.boost({{arg0}})',
          },
        });
      },
    },
    paradeDbConst: {
      self: { codecId: TEXT },
      impl: (self, value) => {
        if (!Number.isInteger(value)) {
          throw paradeDbError(
            'PARADEDB.ARGUMENT_INVALID',
            `paradeDbConst: value must be an integer; got ${String(value)}`,
            { meta: { helper: 'paradeDbConst', argument: 'value', received: value } },
          );
        }
        return buildOperation({
          method: 'paradeDbConst',
          args: [toExpr(self, TEXT_REF), LiteralExpr.of(value)],
          returns: { codecId: TEXT, nullable: false },
          lowering: {
            targetFamily: 'sql',
            template: '{{self}}::pdb.const({{arg0}})',
          },
        });
      },
    },
    paradeDbSlop: {
      self: { codecId: TEXT },
      impl: (self, slop) => {
        if (!Number.isInteger(slop) || slop < 0) {
          throw paradeDbError(
            'PARADEDB.ARGUMENT_INVALID',
            `paradeDbSlop: slop must be a non-negative integer; got ${String(slop)}`,
            { meta: { helper: 'paradeDbSlop', argument: 'slop', received: slop } },
          );
        }
        return buildOperation({
          method: 'paradeDbSlop',
          args: [toExpr(self, TEXT_REF), LiteralExpr.of(slop)],
          returns: { codecId: TEXT, nullable: false },
          lowering: {
            targetFamily: 'sql',
            template: '{{self}}::pdb.slop({{arg0}})',
          },
        });
      },
    },
    // https://docs.paradedb.com/documentation/full-text/proximity
    paradeDbProximity: {
      self: { codecId: TEXT },
      impl: (start) => new ParadeDbProximityChain(start),
    },
  };
}

export const paradedbPackMeta = {
  kind: 'extension',
  id: PARADEDB_EXTENSION_ID,
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  capabilities: {
    postgres: {
      'paradedb/bm25': true,
    },
  },
  indexTypes: paradedbIndexTypes,
  types: {
    queryOperationTypes: {
      import: {
        package: '@internal/extension-paradedb/operation-types',
        named: 'QueryOperationTypes',
        alias: 'ParadeDbQueryOperationTypes',
      },
    },
  },
} as const;
