/**
 * A codec whose output type depends on a column's type parameters is typed, in an emitted `contract.d.ts` and in a `defineContract` contract alike, by its pack's type function (`ParameterizedOutputTypesForTypeParams`). These tests make every parameterized codec of the Postgres and SQLite stacks say how its output type is given, so a new codec cannot fall back to its plain output type unnoticed. `define-contract-sections.test-d.ts` checks that each codec a type function declares appears with type parameters in a parity fixture, where the field type comparison checks the emitted type against the built one.
 */
import type {
  ApplyParameterizedOutputTypes,
  ParameterizedOutputTypesFunction,
} from '@internal/contract/types';
import arktypeJsonPack from '@internal/extension-arktype-json/pack';
import paradedbPack from '@internal/extension-paradedb/pack';
import type { ParameterizedOutputTypesForTypeParams as PgvectorOutputTypes } from '@internal/extension-pgvector/codec-types';
import pgvectorPack from '@internal/extension-pgvector/pack';
import postgisPack from '@internal/extension-postgis/pack';
import { assembleDataTypes } from '@internal/framework-components/codec';
import type { ParameterizedOutputTypesForTypeParams as PostgresOutputTypes } from '@internal/target-postgres/codec-types';
import { assemblePostgresCodecRegistryWithBuiltins } from '@internal/target-postgres/codecs';
import postgresPack from '@internal/target-postgres/pack';
import { createSqliteCodecRegistryWithBuiltins } from '@internal/target-sqlite/codecs';
import { describe, expect, expectTypeOf, it } from 'vitest';

type DeclaredBy<TypeFunction extends ParameterizedOutputTypesFunction> =
  keyof ApplyParameterizedOutputTypes<TypeFunction, Record<string, unknown>>;

type DeclaredCodecs = DeclaredBy<PostgresOutputTypes> | DeclaredBy<PgvectorOutputTypes>;

/** The codecs the type functions declare, listed so a run-time test can read them; the type test below keeps the list equal to the declarations. */
const declaredByTypeFunction = [
  'pg/numeric@1',
  'pg/char@1',
  'sql/char@1',
  'pg/varchar@1',
  'sql/varchar@1',
  'pg/bit@1',
  'pg/varbit@1',
  'pg/timetz@1',
  'pg/time-string@1',
  'pg/timestamp-string@1',
  'pg/timestamptz-string@1',
  'pg/timestamptz-date@1',
  'pg/vector@1',
] as const satisfies readonly DeclaredCodecs[];

const temporalPrecision = 'A precision does not change the Temporal type a value reads as.';
const rawOutput = 'A raw column reads as unknown whatever its type text (ADR 273).';

/** Per stack: the codecs its type functions declare, the parameterized codecs whose output type is the same whatever their type parameters (with the reason), and those that render their output type as text, because no type can compute it from their type parameters. */
type StackClassification = {
  readonly declaredByTypeFunction: readonly string[];
  readonly outputIndependentOfTypeParams: Readonly<Record<string, string>>;
  readonly renderedAsText: readonly string[];
};

const stacks: Readonly<Record<'Postgres and its extensions' | 'SQLite', StackClassification>> = {
  'Postgres and its extensions': {
    declaredByTypeFunction,
    outputIndependentOfTypeParams: {
      'pg/enum@1':
        'Its type parameter names the native enum type; the column reads as the members of its value set.',
      'pg/geometry@1': 'Geometry<Srid> is the same type for every SRID.',
      'pg/interval@1':
        'An interval reads as its months, days and microseconds whatever its precision.',
      'pg/interval-string@1':
        'An interval read as a string is an ISO 8601 duration whatever its precision.',
      'pg/time-temporal@1': temporalPrecision,
      'pg/timestamp-date@1': 'A timestamp read as a Date is a Date whatever its precision.',
      'pg/timestamp-instant@1': temporalPrecision,
      'pg/timestamp-temporal@1': temporalPrecision,
      'pg/timestamptz-temporal@1': temporalPrecision,
      'pg/unboundedint@1': 'A numeric(P, 0) column reads as a bigint whatever its precision.',
      'sql/raw@1': rawOutput,
    },
    renderedAsText: ['arktype/json@1'],
  },
  SQLite: {
    declaredByTypeFunction: [],
    outputIndependentOfTypeParams: {
      'sql/char@1': 'SQLite declares no type function; a character column reads as a string.',
      'sql/varchar@1': 'SQLite declares no type function; a character column reads as a string.',
      'sql/raw@1': rawOutput,
    },
    renderedAsText: [],
  },
};

type Descriptor = {
  readonly codecId: string;
  readonly isParameterized: boolean;
  readonly renderOutputType?: unknown;
};

function parameterizedCodecs(descriptors: Iterable<Descriptor>): readonly Descriptor[] {
  return Array.from(descriptors).filter((descriptor) => descriptor.isParameterized);
}

const postgresExtensions = [pgvectorPack, postgisPack, paradedbPack, arktypeJsonPack];
const postgresRegistry = assemblePostgresCodecRegistryWithBuiltins(
  postgresExtensions,
  assembleDataTypes([postgresPack, ...postgresExtensions]).lookup,
);
const sqliteRegistry = createSqliteCodecRegistryWithBuiltins();

describe('every parameterized codec says how its output type is given', () => {
  it('lists every codec the type functions declare', () => {
    expectTypeOf<(typeof declaredByTypeFunction)[number]>().toEqualTypeOf<DeclaredCodecs>();
  });

  it('finds the parameterized codecs, so the check is not empty', () => {
    expect(parameterizedCodecs(postgresRegistry.values()).map((d) => d.codecId)).toEqual(
      expect.arrayContaining(['pg/vector@1', 'sql/char@1', 'arktype/json@1']),
    );
  });

  describe.each([
    ['Postgres and its extensions', postgresRegistry],
    ['SQLite', sqliteRegistry],
  ] as const)('%s', (stack, registry) => {
    const {
      declaredByTypeFunction: declared,
      outputIndependentOfTypeParams,
      renderedAsText,
    } = stacks[stack];

    it('declares, renders or lists every parameterized codec', () => {
      const classified = new Set<string>([
        ...declared,
        ...renderedAsText,
        ...Object.keys(outputIndependentOfTypeParams),
      ]);
      expect(
        parameterizedCodecs(registry.values())
          .map((descriptor) => descriptor.codecId)
          .filter((id) => !classified.has(id))
          .sort(),
      ).toEqual([]);
    });

    it('lists only parameterized codecs the stack has', () => {
      const codecIds = new Set(
        parameterizedCodecs(registry.values()).map((descriptor) => descriptor.codecId),
      );
      expect(
        [...declared, ...renderedAsText, ...Object.keys(outputIndependentOfTypeParams)].filter(
          (id) => !codecIds.has(id),
        ),
      ).toEqual([]);
    });

    it('renders text only for the codecs listed as rendering it', () => {
      expect(
        parameterizedCodecs(registry.values())
          .filter((descriptor) => typeof descriptor.renderOutputType === 'function')
          .map((descriptor) => descriptor.codecId),
      ).toEqual(renderedAsText);
    });
  });
});
