import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { testPrintContext } from './print-context';
import { INT_FIELD, printingWidget, refusal, TEXT_COLUMN, TEXT_FIELD } from './refusal-support';

it('prints the widget the refusal tests start from', () => {
  expect(printingWidget()).not.toThrow();
});

describe('columns and fields', () => {
  it('refuses a column no field is stored in', () => {
    expect(printingWidget({ columns: { legacy: TEXT_COLUMN } })).toThrow(
      refusal({ namespaceId: 'public', table: 'Widget', column: 'legacy' }),
    );
  });

  it('refuses a required field stored in a nullable column', () => {
    expect(
      printingWidget({
        columns: { name: { ...TEXT_COLUMN, nullable: true } },
        fields: { name: TEXT_FIELD },
      }),
    ).toThrow(refusal({ coordinate: '"public"."Widget"."name"' }));
  });

  it('refuses a list field stored in a column that is not a list', () => {
    expect(
      printingWidget({
        columns: { tags: TEXT_COLUMN },
        fields: { tags: { ...TEXT_FIELD, many: true } },
      }),
    ).toThrow(refusal({ coordinate: '"public"."Widget"."tags"' }));
  });

  it('refuses a scalar field whose codec is not its column codec', () => {
    expect(printingWidget({ columns: { name: TEXT_COLUMN }, fields: { name: INT_FIELD } })).toThrow(
      refusal({ coordinate: '"public"."Widget"."name"' }),
    );
  });

  it('refuses a field whose column names an enum value set the field does not name', () => {
    expect(
      printingWidget({
        domain: {
          enum: { Priority: { codecId: 'pg/text@1', members: [{ name: 'Low', value: 'low' }] } },
        },
        entries: { valueSet: { Priority: { kind: 'valueSet', values: ['low'] } } },
        columns: {
          priority: {
            ...TEXT_COLUMN,
            valueSet: {
              plane: 'storage',
              namespaceId: 'public',
              entityKind: 'valueSet',
              entityName: 'Priority',
            },
          },
        },
        fields: { priority: TEXT_FIELD },
      }),
    ).toThrow(refusal({ coordinate: '"public"."Widget"."priority"' }));
  });

  it('refuses a model field whose type is a union of types', () => {
    expect(
      printingWidget({
        columns: { payload: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false } },
        fields: {
          payload: {
            nullable: false,
            type: {
              kind: 'union',
              members: [
                { kind: 'scalar', codecId: 'pg/int4@1' },
                { kind: 'scalar', codecId: 'pg/text@1' },
              ],
            },
          },
        },
      }),
    ).toThrow(refusal({ coordinate: '"public"."Widget"."payload"', kind: 'union' }));
  });

  it('refuses a model field that is a dictionary', () => {
    expect(
      printingWidget({
        columns: { counts: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false } },
        fields: {
          counts: { nullable: false, dict: true, type: { kind: 'scalar', codecId: 'pg/jsonb@1' } },
        },
      }),
    ).toThrow(refusal({ coordinate: '"public"."Widget"."counts"' }));
  });

  it('refuses a column with its own control policy', () => {
    expect(
      printingWidget({
        columns: { name: { ...TEXT_COLUMN, control: 'external' } },
        fields: { name: TEXT_FIELD },
      }),
    ).toThrow(refusal({ coordinate: '"public"."Widget"."name"', control: 'external' }));
  });

  describe('a column written through a type constructor the stack contributes', () => {
    const context = testPrintContext({
      types: {
        geo: {
          Shape: {
            kind: 'typeConstructor',
            args: [{ kind: 'string', name: 'shape' }],
            output: {
              codecId: 'pg/geometry@1',
              nativeType: 'geometry',
              typeParams: { shape: { kind: 'arg', index: 0 } },
            },
          },
        },
      },
    });

    function withShape(typeParams: Record<string, unknown>) {
      return printingWidget(
        {
          columns: {
            area: { nativeType: 'geometry', codecId: 'pg/geometry@1', nullable: false, typeParams },
          },
          fields: {
            area: {
              nullable: false,
              type: { kind: 'scalar', codecId: 'pg/geometry@1', typeParams },
            },
          },
        },
        context,
      );
    }

    it('refuses a column whose codec no PSL type in the stack produces, naming the column', () => {
      const vector = { nativeType: 'vector', codecId: 'pg/vector@1', typeParams: { length: 3 } };
      expect(
        printingWidget({
          columns: { v: { ...vector, nullable: false } },
          fields: {
            v: {
              nullable: false,
              type: { kind: 'scalar', codecId: vector.codecId, typeParams: vector.typeParams },
            },
          },
        }),
      ).toThrow(
        refusal({
          coordinate: '"public"."Widget"."v"',
          nativeType: 'vector',
          codecId: 'pg/vector@1',
        }),
      );
    });

    it('writes a string type argument between quotes', () => {
      expect(withShape({ shape: 'Point' })).not.toThrow();
    });

    it('refuses a string type argument the PSL source would read back differently', () => {
      expect(withShape({ shape: 'Point "A"' })).toThrow(
        refusal({ coordinate: '"public"."Widget"."area"', argument: 'Point "A"' }),
      );
    });

    it('refuses a column with no value for an argument the constructor requires', () => {
      expect(withShape({})).toThrow(
        refusal({
          coordinate: '"public"."Widget"."area"',
          nativeType: 'geometry',
          codecId: 'pg/geometry@1',
        }),
      );
    });
  });
});

describe('defaults and generated values', () => {
  it('refuses a domain enum default that is not a member', () => {
    expect(
      printingWidget({
        domain: {
          enum: {
            Priority: { codecId: 'pg/text@1', members: [{ name: 'Low', value: 'low' }] },
          },
        },
        entries: { valueSet: { Priority: { kind: 'valueSet', values: ['low'] } } },
        columns: {
          priority: {
            ...TEXT_COLUMN,
            default: { kind: 'literal', value: 'high' },
            valueSet: {
              plane: 'storage',
              namespaceId: 'public',
              entityKind: 'valueSet',
              entityName: 'Priority',
            },
          },
        },
        fields: {
          priority: {
            ...TEXT_FIELD,
            valueSet: {
              plane: 'domain',
              namespaceId: 'public',
              entityKind: 'enum',
              entityName: 'Priority',
            },
          },
        },
      }),
    ).toThrow(refusal({ coordinate: '"public"."Widget"."priority"', pslTypeName: 'Priority' }));
  });

  function withGenerator(
    phases: Record<string, unknown>,
    column: Record<string, unknown> = TEXT_COLUMN,
  ) {
    return printingWidget({
      columns: { value: column },
      fields: { value: TEXT_FIELD },
      contract: {
        execution: {
          mutations: {
            defaults: [
              blindCast<never, 'test generator phases'>({
                ref: { namespace: 'public', entry: 'Widget', field: 'value' },
                ...phases,
              }),
            ],
          },
        },
      },
    });
  }

  it('refuses a generator on update that is not the wall-clock-now generator', () => {
    expect(withGenerator({ onUpdate: { kind: 'generator', id: 'uuidv4' } })).toThrow(
      refusal({ coordinate: '"public"."Widget"."value"', onCreate: undefined, onUpdate: 'uuidv4' }),
    );
  });

  it('refuses a generator with no PSL default function', () => {
    expect(withGenerator({ onCreate: { kind: 'generator', id: 'slugid' } })).toThrow(
      refusal({ coordinate: '"public"."Widget"."value"', onCreate: 'slugid', onUpdate: undefined }),
    );
  });

  it('refuses a column with both an id generator and a database default', () => {
    expect(
      withGenerator(
        { onCreate: { kind: 'generator', id: 'uuidv4' } },
        { ...TEXT_COLUMN, default: { kind: 'function', expression: 'gen_random_uuid()' } },
      ),
    ).toThrow(refusal({ coordinate: '"public"."Widget"."value"', onCreate: 'uuidv4' }));
  });

  it('refuses a generated value for a column no field is stored in', () => {
    expect(
      printingWidget({
        contract: {
          execution: {
            mutations: {
              defaults: [
                {
                  ref: { namespace: 'public', entry: 'Widget', field: 'missing' },
                  onCreate: { kind: 'generator', id: 'uuidv4' },
                },
              ],
            },
          },
        },
      }),
    ).toThrow(refusal({ coordinate: '"public"."Widget"."missing"' }));
  });
});

describe('checks and indexes', () => {
  it('refuses a wire-named check whose name is not its prefix and the hash of its expression', () => {
    expect(
      printingWidget({
        table: {
          checks: [
            {
              name: 'widget_id_positive_00000000',
              prefix: 'widget_id_positive',
              expression: 'id > 0',
            },
          ],
        },
      }),
    ).toThrow(
      refusal({
        namespaceId: 'public',
        table: 'Widget',
        name: 'widget_id_positive_00000000',
        prefix: 'widget_id_positive',
      }),
    );
  });

  it('refuses a managed list column without the element check the PSL source derives', () => {
    expect(
      printingWidget({
        columns: { tags: { ...TEXT_COLUMN, many: true } },
        fields: { tags: { ...TEXT_FIELD, many: true } },
      }),
    ).toThrow(
      refusal({
        namespaceId: 'public',
        table: 'Widget',
        name: 'Widget_tags_elem_not_null_aecbe9e2',
      }),
    );
  });

  it('prints a list column of a table that is not managed without derived checks', () => {
    expect(
      printingWidget({
        columns: { tags: { ...TEXT_COLUMN, many: true } },
        fields: { tags: { ...TEXT_FIELD, many: true } },
        table: { control: 'external' },
      }),
    ).not.toThrow();
  });

  it('refuses a wire-named index whose name is not its prefix and the hash of its content', () => {
    expect(
      printingWidget({
        table: {
          indexes: [
            { name: 'widget_id_00000000', prefix: 'widget_id', unique: false, columns: ['id'] },
          ],
        },
      }),
    ).toThrow(
      refusal({
        namespaceId: 'public',
        table: 'Widget',
        name: 'widget_id_00000000',
        prefix: 'widget_id',
      }),
    );
  });

  it('refuses an index option whose value is not a string', () => {
    expect(
      printingWidget({
        table: {
          indexes: [
            {
              name: 'widget_id_idx',
              unique: false,
              columns: ['id'],
              type: 'btree',
              options: { fillfactor: 70 },
            },
          ],
        },
      }),
    ).toThrow(
      refusal({
        namespaceId: 'public',
        table: 'Widget',
        index: 'widget_id_idx',
        key: 'fillfactor',
      }),
    );
  });
});
