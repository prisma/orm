import type { SqlPslBuildContext } from '@internal/family-sql/control';
import { singleGeneratorBinding } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import {
  PG_TIME_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
} from '../../src/core/codec-ids';
import { postgresNowGeneratorIds } from '../../src/core/now-generators';
import { testBuildContext } from './build-context';
import {
  buildModels,
  type ColumnShape,
  fieldText,
  INT_COLUMN,
  TEXT_COLUMN,
  table,
} from './print-support';

function withGenerator(
  column: ColumnShape,
  phases: Record<string, unknown>,
  context?: SqlPslBuildContext,
): string | undefined {
  const [model] = buildModels({
    ...(context === undefined ? {} : { context }),
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
        defaults: [{ ref: { namespace: 'public', entry: 'Widget', field: 'value' }, ...phases }],
      },
    },
  });
  const field = model?.fields[1];
  return field === undefined ? undefined : fieldText(field);
}

function refusalOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

const generator = (id: string, params?: Record<string, unknown>) =>
  params === undefined ? { kind: 'generator', id } : { kind: 'generator', id, params };

const timestamptz: ColumnShape = {
  dataType: 'pg/timestamptz',
  codecId: PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
  nullable: false,
};

const time3: ColumnShape = {
  dataType: 'pg/time',
  codecId: PG_TIME_TEMPORAL_CODEC_ID,
  nullable: false,
  typeParams: { precision: 3 },
};

const char = (length: number): ColumnShape => ({
  dataType: 'pg/char',
  codecId: 'sql/char@1',
  nullable: false,
  typeParams: { length },
});

describe('generated values', () => {
  it('writes each identifier generator as the @onCreate call of its function', () => {
    expect({
      uuidv4: withGenerator(TEXT_COLUMN, { onCreate: generator('uuidv4') }),
      uuidv7: withGenerator(TEXT_COLUMN, { onCreate: generator('uuidv7') }),
      cuid2: withGenerator(TEXT_COLUMN, { onCreate: generator('cuid2') }),
      ulid: withGenerator(TEXT_COLUMN, { onCreate: generator('ulid') }),
      ksuid: withGenerator(TEXT_COLUMN, { onCreate: generator('ksuid') }),
      nanoid: withGenerator(TEXT_COLUMN, { onCreate: generator('nanoid', { size: 10 }) }),
    }).toEqual({
      uuidv4: 'value String @onCreate(uuid())',
      uuidv7: 'value String @onCreate(uuid(7))',
      cuid2: 'value String @onCreate(cuid(2))',
      ulid: 'value String @onCreate(ulid())',
      ksuid: 'value String @onCreate(ksuid())',
      nanoid: 'value String @onCreate(nanoid(10))',
    });
  });

  it('writes a nanoid size as nanoid(size) on every column, and no size as nanoid()', () => {
    expect({
      char16: withGenerator(char(16), { onCreate: generator('nanoid', { size: 16 }) }),
      text16: withGenerator(TEXT_COLUMN, { onCreate: generator('nanoid', { size: 16 }) }),
      char36: withGenerator(char(36), { onCreate: generator('nanoid') }),
    }).toEqual({
      char16: 'value Char(16) @onCreate(nanoid(16))',
      text16: 'value String @onCreate(nanoid(16))',
      char36: 'value Char(36) @onCreate(nanoid())',
    });
  });

  it('refuses a generator on a column too short for what it writes, which would not emit again', () => {
    expect(
      refusalOf(() => withGenerator(char(5), { onCreate: generator('uuidv4') })),
    ).toMatchObject({
      code: 'CONTRACT.PRINT_UNSUPPORTED',
      message:
        'contract print: column "public"."Widget"."value" generates "uuidv4" on create, but @onCreate(uuid()) is refused: uuid() writes 36 characters, which does not fit a column of 5 characters.',
      meta: {
        call: 'uuid()',
        stored: { kind: 'generator', id: 'uuidv4' },
        readBack: undefined,
        refusedBecause: 'uuid() writes 36 characters, which does not fit a column of 5 characters.',
      },
    });
  });

  it('writes a now generator on create and on update', () => {
    const now = generator(postgresNowGeneratorIds[PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID]);
    expect(withGenerator(timestamptz, { onCreate: now, onUpdate: now })).toBe(
      'value DateTime(as: temporal) @onCreate(now()) @onUpdate(now())',
    );
  });

  it("writes a time now generator whose precision is the column's as @onUpdate(now())", () => {
    expect(withGenerator(time3, { onUpdate: generator('plainTimeNow', { precision: 3 }) })).toBe(
      'value Time(as: temporal, precision: 3) @onUpdate(now())',
    );
  });

  it('writes a generator beside the database default', () => {
    expect(
      withGenerator(
        { ...timestamptz, default: { kind: 'function', expression: 'now()' } },
        { onCreate: generator('instantNow') },
      ),
    ).toBe('value DateTime(as: temporal) @default(now()) @onCreate(now())');
  });

  it('writes a generator through the generator function an extension contributes', () => {
    const context = testBuildContext({
      generatorFunctions: [
        {
          name: 'slugid',
          signature: { documentation: 'slugid' },
          bindings: [singleGeneratorBinding({ codecIds: ['pg/text@1'], generatorId: 'slugid' })],
        },
      ],
    });
    expect(withGenerator(TEXT_COLUMN, { onCreate: generator('slugid') }, context)).toBe(
      'value String @onCreate(slugid())',
    );
  });

  describe('refuses', () => {
    it('a generator whose call reads back with other params', () => {
      expect(
        refusalOf(() => withGenerator(time3, { onUpdate: generator('plainTimeNow') })),
      ).toMatchObject({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        message:
          'contract print: column "public"."Widget"."value" generates "plainTimeNow" on update, but @onUpdate(now()) reads back as "plainTimeNow" with params {"precision":3}.',
        meta: {
          coordinate: '"public"."Widget"."value"',
          phase: 'onUpdate',
          call: 'now()',
          stored: { kind: 'generator', id: 'plainTimeNow' },
          readBack: { kind: 'generator', id: 'plainTimeNow', params: { precision: 3 } },
        },
      });
    });

    it('a generator on a list column', () => {
      expect(
        refusalOf(() =>
          withGenerator(
            { ...TEXT_COLUMN, many: { elementNullable: false } },
            { onCreate: generator('uuidv4') },
          ),
        ),
      ).toMatchObject({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        message:
          'contract print: column "public"."Widget"."value" is a list and generates "uuidv4" on create, which cannot be written in Prisma 8 PSL.',
      });
    });

    it('a generator that no component in the configured stack registers, and says to add the extension', () => {
      expect(
        refusalOf(() => withGenerator(TEXT_COLUMN, { onCreate: generator('slugid') })),
      ).toMatchObject({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        message:
          'contract print: column "public"."Widget"."value" is generated by "slugid" on create, which no component in the configured stack registers.',
        fix: 'Add the extension that registers the generator and its generator function to the config, or keep authoring this contract in its current source.',
        meta: {
          coordinate: '"public"."Widget"."value"',
          phase: 'onCreate',
          generatorId: 'slugid',
          codecId: 'pg/text@1',
        },
      });
    });

    it('a generator a configured component registers that no function writes for the codec, and names the component', () => {
      const context = testBuildContext({
        componentIdsByGenerator: new Map([['slugid', 'slugid-pack']]),
      });
      expect(
        refusalOf(() => withGenerator(TEXT_COLUMN, { onCreate: generator('slugid') }, context)),
      ).toMatchObject({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        message:
          'contract print: column "public"."Widget"."value" is generated by "slugid" on create, which "slugid-pack" registers, but no generator function in the configured stack writes it for codec "pg/text@1".',
        fix: 'If "slugid-pack" declares a generator function that produces it, its author must bind that function to codec "pg/text@1", as the upgrade instructions "default-generators-to-on-create" for extension authors describe. Until then, keep authoring this contract in its current source.',
        meta: { componentId: 'slugid-pack' },
      });
    });

    it('a generator a configured component without an id registers, without naming it', () => {
      const context = testBuildContext({
        componentIdsByGenerator: new Map([['slugid', undefined]]),
      });
      expect(
        refusalOf(() => withGenerator(TEXT_COLUMN, { onCreate: generator('slugid') }, context)),
      ).toMatchObject({
        message:
          'contract print: column "public"."Widget"."value" is generated by "slugid" on create, which a configured component registers, but no generator function in the configured stack writes it for codec "pg/text@1".',
      });
    });
  });
});
