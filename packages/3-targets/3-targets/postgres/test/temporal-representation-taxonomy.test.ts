/**
 * The representation taxonomy, in executable form.
 *
 * Every PostgreSQL temporal type offers two representations, and the table below is the contract:
 * one native type, two codecs, one of which hands back a `Temporal.*` and one of which hands back
 * PostgreSQL's own text. These assertions are written against that contract rather than against
 * what the descriptors happen to declare — a test that reads a descriptor's `codecId` and asserts
 * it equals that same `codecId` would pass no matter what the code said.
 *
 * The surface exercised here is reached in production only from the emitter and the authoring
 * helpers, both of which live in other packages. That is why it needs covering from here: the
 * integration suites that drive it prove the pipeline works, not that this package's half of it
 * declares the right things.
 */

import { ColumnRef, type ProjectionExpr } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  pgDateStringColumn,
  pgDateStringDescriptor,
  pgDateTemporalColumn,
  pgDateTemporalDescriptor,
  pgTimeStringColumn,
  pgTimeStringDescriptor,
  pgTimestampStringColumn,
  pgTimestampStringDescriptor,
  pgTimestampTemporalColumn,
  pgTimestampTemporalDescriptor,
  pgTimestamptzStringColumn,
  pgTimestamptzStringDescriptor,
  pgTimestamptzTemporalColumn,
  pgTimestamptzTemporalDescriptor,
  pgTimeTemporalColumn,
  pgTimeTemporalDescriptor,
} from '../src/core/codecs';

interface ColumnSpecShape {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams: Record<string, unknown> | undefined;
}

interface Representation {
  readonly codecId: string;
  readonly descriptor: {
    readonly codecId: string;
    readonly traits: readonly string[];
    readonly targetTypes: readonly string[];
    readonly renderOutputType?: (params: never) => string | undefined;
    readonly factory: (params: never) => (ctx: { name: string }) => { id: string };
    readonly nativeTypeFor: (ref: { codecId: string }) => string;
    readonly projectJson: (
      expression: ProjectionExpr,
      ref: { codecId: string; many?: boolean },
    ) => ProjectionExpr;
  };
  readonly column: (...args: never[]) => ColumnSpecShape;
  /** The spelling the emitter renders for a read, or `undefined` where the codec renders none. */
  readonly rendersAtPrecisionSix: string | undefined;
}

interface TaxonomyRow {
  /**
   * The short native-type identifier a contract carries, and what introspection resolves against.
   */
  readonly nativeType: string;
  /** The spelling rendered into DDL, which for two of the four is not the identifier. */
  readonly ddlType: string;
  /** Whether the pair's types carry a precision argument. */
  readonly precisionBearing: boolean;
  readonly temporal: Representation;
  readonly string: Representation;
}

/**
 * One row per PostgreSQL temporal type, transcribed from the project spec's taxonomy table.
 * `pg/timetz@1` and `pg/interval@1` are deliberately absent: they have one representation, not two.
 */
const TAXONOMY: readonly TaxonomyRow[] = [
  {
    nativeType: 'date',
    ddlType: 'date',
    precisionBearing: false,
    temporal: {
      codecId: 'pg/date-temporal@1',
      descriptor: pgDateTemporalDescriptor,
      column: pgDateTemporalColumn,
      rendersAtPrecisionSix: undefined,
    },
    string: {
      codecId: 'pg/date-string@1',
      descriptor: pgDateStringDescriptor,
      column: pgDateStringColumn,
      // A void-params descriptor's renderer is never consulted, and branding the type would make
      // a plain string unassignable on writes. Deliberate; see PgDateStringDescriptor.
      rendersAtPrecisionSix: undefined,
    },
  },
  {
    nativeType: 'timestamp',
    ddlType: 'timestamp without time zone',
    precisionBearing: true,
    temporal: {
      codecId: 'pg/timestamp-temporal@1',
      descriptor: pgTimestampTemporalDescriptor,
      column: pgTimestampTemporalColumn,
      rendersAtPrecisionSix: undefined,
    },
    string: {
      codecId: 'pg/timestamp-string@1',
      descriptor: pgTimestampStringDescriptor,
      column: pgTimestampStringColumn,
      rendersAtPrecisionSix: 'TimestampString<6>',
    },
  },
  {
    nativeType: 'timestamptz',
    ddlType: 'timestamp with time zone',
    precisionBearing: true,
    temporal: {
      codecId: 'pg/timestamptz-temporal@1',
      descriptor: pgTimestamptzTemporalDescriptor,
      column: pgTimestamptzTemporalColumn,
      rendersAtPrecisionSix: undefined,
    },
    string: {
      codecId: 'pg/timestamptz-string@1',
      descriptor: pgTimestamptzStringDescriptor,
      column: pgTimestamptzStringColumn,
      rendersAtPrecisionSix: 'TimestamptzString<6>',
    },
  },
  {
    nativeType: 'time',
    ddlType: 'time',
    precisionBearing: true,
    temporal: {
      codecId: 'pg/time-temporal@1',
      descriptor: pgTimeTemporalDescriptor,
      column: pgTimeTemporalColumn,
      rendersAtPrecisionSix: undefined,
    },
    string: {
      codecId: 'pg/time-string@1',
      descriptor: pgTimeStringDescriptor,
      column: pgTimeStringColumn,
      rendersAtPrecisionSix: 'TimeString<6>',
    },
  },
];

const halves = TAXONOMY.flatMap((row) => [
  { row, kind: 'temporal' as const, rep: row.temporal },
  { row, kind: 'string' as const, rep: row.string },
]);

const sourceExpression = ColumnRef.of('reading', 'at');

describe('the eight representation-explicit temporal codecs', () => {
  it('covers every PostgreSQL temporal type that has two representations, and no others', () => {
    expect(TAXONOMY.map((row) => row.nativeType)).toEqual([
      'date',
      'timestamp',
      'timestamptz',
      'time',
    ]);
    expect(halves).toHaveLength(8);
  });

  describe.each(halves)('$rep.codecId', ({ row, kind, rep }) => {
    it('declares the id the taxonomy names', () => {
      expect(rep.descriptor.codecId).toBe(rep.codecId);
    });

    it('stores into the same PostgreSQL type as its counterpart', () => {
      expect(rep.descriptor.nativeTypeFor({ codecId: rep.codecId })).toBe(row.ddlType);
    });

    // Representation is a choice about what a read hands back, never about what can be compared:
    // a column must sort and match identically whichever half of the pair it was authored with.
    it('carries equality and ordering', () => {
      expect(rep.descriptor.traits).toEqual(['equality', 'order']);
    });

    // Introspection ownership. A bare `timestamptz` column has to resolve to exactly one codec, so
    // the string half claims no target type at all — choosing it is always something an author
    // writes down.
    it(
      kind === 'temporal'
        ? 'claims its native type for introspection'
        : 'claims no native type, so introspection cannot land on it',
      () => {
        expect(rep.descriptor.targetTypes).toEqual(kind === 'temporal' ? [row.nativeType] : []);
      },
    );

    it('renders the read type the emitter splices, or none', () => {
      const render = rep.descriptor.renderOutputType;
      expect(render?.({ precision: 6 } as never)).toBe(rep.rendersAtPrecisionSix);
    });

    it('builds a codec instance carrying the same id', () => {
      const instance = rep.descriptor.factory({} as never)({ name: '<test>' });
      expect(instance.id).toBe(rep.codecId);
    });

    it('projects a scalar read and lifts an array read differently', () => {
      const scalar = rep.descriptor.projectJson(sourceExpression, { codecId: rep.codecId });
      const lifted = rep.descriptor.projectJson(sourceExpression, {
        codecId: rep.codecId,
        many: true,
      });
      expect(scalar).toBeDefined();
      expect(lifted).toBeDefined();
      expect(lifted).not.toBe(scalar);
    });

    it('has a column helper naming the same codec and native type', () => {
      const spec = row.precisionBearing
        ? rep.column({ precision: 6 } as never)
        : rep.column(...([] as never[]));
      expect({ codecId: spec.codecId, nativeType: spec.nativeType }).toEqual({
        codecId: rep.codecId,
        nativeType: row.nativeType,
      });
      expect(spec.typeParams).toEqual(row.precisionBearing ? { precision: 6 } : undefined);
    });
  });
});
