import { describe, expect, it } from 'vitest';
import {
  buildModels,
  type ColumnShape,
  fieldText,
  INT_COLUMN,
  TEXT_COLUMN,
  table,
} from './print-support';

describe('generated values', () => {
  function withGenerator(column: ColumnShape, phases: Record<string, unknown>): string | undefined {
    const [model] = buildModels({
      models: {
        Widget: { table: 'Widget', fields: { id: { column: 'id' }, value: { column: 'value' } } },
      },
      tables: {
        Widget: table({
          columns: { id: INT_COLUMN, value: column },
          primaryKey: { columns: ['id'] },
        }),
      },
      execution: {
        mutations: {
          defaults: [{ ref: { namespace: 'public', table: 'Widget', column: 'value' }, ...phases }],
        },
      },
    });
    const field = model?.fields[1];
    return field === undefined ? undefined : fieldText(field);
  }

  it('prints an id generator as the default function that produces it', () => {
    expect(withGenerator(TEXT_COLUMN, { onCreate: { kind: 'generator', id: 'uuidv4' } })).toBe(
      'value String @default(uuid())',
    );
    expect(withGenerator(TEXT_COLUMN, { onCreate: { kind: 'generator', id: 'uuidv7' } })).toBe(
      'value String @default(uuid(7))',
    );
    expect(withGenerator(TEXT_COLUMN, { onCreate: { kind: 'generator', id: 'cuid2' } })).toBe(
      'value String @default(cuid(2))',
    );
    expect(withGenerator(TEXT_COLUMN, { onCreate: { kind: 'generator', id: 'ulid' } })).toBe(
      'value String @default(ulid())',
    );
    expect(
      withGenerator(TEXT_COLUMN, {
        onCreate: { kind: 'generator', id: 'nanoid', params: { size: 10 } },
      }),
    ).toBe('value String @default(nanoid(10))');
  });

  it('prints a wall-clock-now pair as the temporal preset of the column codec', () => {
    expect(
      withGenerator(
        {
          nativeType: 'timestamp',
          codecId: 'pg/timestamp-temporal@1',
          nullable: false,
          typeParams: { precision: 3 },
        },
        {
          onCreate: { kind: 'generator', id: 'plainDateTimeNow' },
          onUpdate: { kind: 'generator', id: 'plainDateTimeNow' },
        },
      ),
    ).toBe('value temporal.timestamp(3, onCreate: now, onUpdate: now)');
  });

  it('refuses a column that pairs the wall-clock-now generator with a different one', () => {
    const timestamp = {
      nativeType: 'timestamp',
      codecId: 'pg/timestamp-temporal@1',
      nullable: false,
    };
    const refusal = (phases: Record<string, unknown>): unknown => {
      try {
        withGenerator(timestamp, phases);
      } catch (error) {
        return error;
      }
      return undefined;
    };

    expect(
      refusal({
        onCreate: { kind: 'generator', id: 'plainDateTimeNow' },
        onUpdate: { kind: 'generator', id: 'uuidv4' },
      }),
    ).toMatchObject({
      code: 'CONTRACT.PRINT_UNSUPPORTED',
      meta: {
        coordinate: '"public"."Widget"."value"',
        onCreate: 'plainDateTimeNow',
        onUpdate: 'uuidv4',
      },
    });
    expect(
      refusal({
        onCreate: { kind: 'generator', id: 'uuidv4' },
        onUpdate: { kind: 'generator', id: 'plainDateTimeNow' },
      }),
    ).toMatchObject({
      code: 'CONTRACT.PRINT_UNSUPPORTED',
      meta: {
        coordinate: '"public"."Widget"."value"',
        onCreate: 'uuidv4',
        onUpdate: 'plainDateTimeNow',
      },
    });
  });
});
