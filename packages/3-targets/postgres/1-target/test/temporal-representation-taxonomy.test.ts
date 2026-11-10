import { ColumnRef, type ProjectionExpr } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  pgTimestampDateColumn,
  pgTimestampDateDescriptor,
  pgTimestamptzDateColumn,
  pgTimestamptzDateDescriptor,
} from '../src/core/date-codecs';
import {
  pgDateTemporalColumn,
  pgDateTemporalDescriptor,
  pgTimestampInstantColumn,
  pgTimestampInstantDescriptor,
  pgTimestampTemporalColumn,
  pgTimestampTemporalDescriptor,
  pgTimestamptzTemporalColumn,
  pgTimestamptzTemporalDescriptor,
  pgTimeTemporalColumn,
  pgTimeTemporalDescriptor,
} from '../src/core/temporal-codecs';
import {
  pgDateStringColumn,
  pgDateStringDescriptor,
  pgTimeStringColumn,
  pgTimeStringDescriptor,
  pgTimestampStringColumn,
  pgTimestampStringDescriptor,
  pgTimestamptzStringColumn,
  pgTimestamptzStringDescriptor,
} from '../src/core/temporal-string-codecs';

interface ColumnSpecShape {
  readonly codecId: string;
  readonly typeText?: string;
  readonly typeParams: Record<string, unknown> | undefined;
}

interface Representation {
  readonly codecId: string;
  readonly descriptor: {
    readonly codecId: string;
    readonly traits: readonly string[];
    readonly factory: (params: never) => (ctx: { name: string }) => { id: string };
    readonly dataType: string;
    readonly projectJson: (
      expression: ProjectionExpr,
      ref: { codecId: string; many?: boolean },
    ) => ProjectionExpr;
  };
  readonly column: (...args: never[]) => ColumnSpecShape;
}

interface TaxonomyRow {
  readonly typeText: string;
  readonly dataType: string;
  readonly precisionBearing: boolean;
  readonly temporal: Representation;
  readonly string: Representation;
  readonly date?: Representation;
  readonly instant?: Representation;
}

const TAXONOMY: readonly TaxonomyRow[] = [
  {
    typeText: 'date',
    dataType: 'pg/date',
    precisionBearing: false,
    temporal: {
      codecId: 'pg/date-temporal@1',
      descriptor: pgDateTemporalDescriptor,
      column: pgDateTemporalColumn,
    },
    string: {
      codecId: 'pg/date-string@1',
      descriptor: pgDateStringDescriptor,
      column: pgDateStringColumn,
    },
  },
  {
    typeText: 'timestamp',
    dataType: 'pg/timestamp',
    precisionBearing: true,
    temporal: {
      codecId: 'pg/timestamp-temporal@1',
      descriptor: pgTimestampTemporalDescriptor,
      column: pgTimestampTemporalColumn,
    },
    string: {
      codecId: 'pg/timestamp-string@1',
      descriptor: pgTimestampStringDescriptor,
      column: pgTimestampStringColumn,
    },
    date: {
      codecId: 'pg/timestamp-date@1',
      descriptor: pgTimestampDateDescriptor,
      column: pgTimestampDateColumn,
    },
    instant: {
      codecId: 'pg/timestamp-instant@1',
      descriptor: pgTimestampInstantDescriptor,
      column: pgTimestampInstantColumn,
    },
  },
  {
    typeText: 'timestamptz',
    dataType: 'pg/timestamptz',
    precisionBearing: true,
    temporal: {
      codecId: 'pg/timestamptz-temporal@1',
      descriptor: pgTimestamptzTemporalDescriptor,
      column: pgTimestamptzTemporalColumn,
    },
    string: {
      codecId: 'pg/timestamptz-string@1',
      descriptor: pgTimestamptzStringDescriptor,
      column: pgTimestamptzStringColumn,
    },
    date: {
      codecId: 'pg/timestamptz-date@1',
      descriptor: pgTimestamptzDateDescriptor,
      column: pgTimestamptzDateColumn,
    },
  },
  {
    typeText: 'time',
    dataType: 'pg/time',
    precisionBearing: true,
    temporal: {
      codecId: 'pg/time-temporal@1',
      descriptor: pgTimeTemporalDescriptor,
      column: pgTimeTemporalColumn,
    },
    string: {
      codecId: 'pg/time-string@1',
      descriptor: pgTimeStringDescriptor,
      column: pgTimeStringColumn,
    },
  },
];

const representations = TAXONOMY.flatMap((row) => [
  { row, kind: 'temporal' as const, rep: row.temporal },
  { row, kind: 'string' as const, rep: row.string },
  ...(row.date ? [{ row, kind: 'date' as const, rep: row.date }] : []),
  ...(row.instant ? [{ row, kind: 'instant' as const, rep: row.instant }] : []),
]);

const sourceExpression = ColumnRef.of('reading', 'at');

describe('the eleven representation-explicit temporal codecs', () => {
  describe.each(representations)('$rep.codecId', ({ row, rep }) => {
    it('declares the id the taxonomy names', () => {
      expect(rep.descriptor.codecId).toBe(rep.codecId);
    });

    it('represents the same data type as its counterpart', () => {
      expect(rep.descriptor.dataType).toBe(row.dataType);
    });

    it('carries equality and ordering', () => {
      expect(rep.descriptor.traits).toEqual(['equality', 'order']);
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
      expect({ codecId: spec.codecId }).toEqual({
        codecId: rep.codecId,
      });
      expect(spec.typeParams).toEqual(row.precisionBearing ? { precision: 6 } : undefined);
    });
  });
});
