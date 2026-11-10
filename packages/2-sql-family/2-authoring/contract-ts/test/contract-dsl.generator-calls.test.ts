import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { createComposedAuthoringHelpers } from '../src/composed-authoring-helpers';
import { field, type ScalarFieldBuilder } from '../src/contract-builder';
import { buildContractDefinition } from '../src/contract-lowering';
import { columnDescriptor } from './helpers/column-descriptor';
import { familyPack, slugidPack, targetPack } from './helpers/generator-function-packs';

const textColumn = columnDescriptor('pg/text@1');
const byteaColumn = columnDescriptor('pg/bytea@1');
const time3Column = { ...columnDescriptor('pg/time-temporal@1'), typeParams: { precision: 3 } };

const { model, gen } = createComposedAuthoringHelpers({
  ...testTypeLookups,
  family: familyPack,
  target: targetPack,
  extensions: { slugid: slugidPack },
});

function executionDefaultsOf(fields: Record<string, ScalarFieldBuilder>) {
  const definition = buildContractDefinition({
    family: familyPack,
    target: targetPack,
    extensions: { slugid: slugidPack },
    createNamespace: createTestSqlNamespace,
    ...testTypeLookups,
    models: { Event: model('Event', { fields }) },
  });
  return Object.fromEntries(
    (definition.models[0]?.fields ?? []).map((node) => [node.fieldName, node.executionDefaults]),
  );
}

describe('gen', () => {
  it('holds one call per generator function the packs declare, extensions included', () => {
    expect({
      names: Object.keys(gen).sort(),
      uuid7: gen.uuid(7),
      uuid: gen.uuid(),
      slugid: gen.slugid(),
    }).toEqual({
      names: ['now', 'slugid', 'uuid'],
      uuid7: { name: 'uuid', args: { version: 7 } },
      uuid: { name: 'uuid', args: {} },
      slugid: { name: 'slugid', args: {} },
    });
  });
});

describe('.onCreate and .onUpdate', () => {
  it('resolve an extension function', () => {
    expect(
      executionDefaultsOf({ id: field.column(textColumn).id().onCreate(gen.slugid()) }),
    ).toEqual({ id: { onCreate: { kind: 'generator', id: 'slugid' } } });
  });

  it("resolve each call by the field's codec and type params", () => {
    expect(
      executionDefaultsOf({
        id: field.column(textColumn).id().onCreate(gen.uuid(7)),
        seenAt: field.column(time3Column).onUpdate(gen.now()),
        stamped: field.column(time3Column).onCreate(gen.now()).onUpdate(gen.now()),
      }),
    ).toEqual({
      id: { onCreate: { kind: 'generator', id: 'uuidv7' } },
      seenAt: { onUpdate: { kind: 'generator', id: 'plainTimeNow', params: { precision: 3 } } },
      stamped: {
        onCreate: { kind: 'generator', id: 'plainTimeNow', params: { precision: 3 } },
        onUpdate: { kind: 'generator', id: 'plainTimeNow', params: { precision: 3 } },
      },
    });
  });

  it('refuse a function the codec does not bind', () => {
    expect(() =>
      executionDefaultsOf({ id: field.column(byteaColumn).id().onCreate(gen.uuid()) }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Field "Event.id": uuid() does not apply to codec "pg/bytea@1". No generator function applies to this codec.',
        meta: {
          modelName: 'Event',
          fieldName: 'id',
          codecId: 'pg/bytea@1',
          function: 'uuid',
          reason: 'generator-not-applicable',
        },
      }),
    );
  });

  it('refuse a function no pack declares', () => {
    expect(() =>
      executionDefaultsOf({
        id: field.column(textColumn).id().onCreate({ name: 'ksuid', args: {} }),
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: expect.objectContaining({ function: 'ksuid', reason: 'generator-unknown' }),
      }),
    );
  });

  it('refuse a pack that registers a generator another pack registers, as contract emit does', () => {
    const uuidCodecPack = {
      ...slugidPack,
      id: 'uuid-codec-pack',
      generatorFunctions: [],
      controlMutationDefaults: {
        defaultFunctionRegistry: new Map(),
        generatorDescriptors: [{ id: 'uuidv4' }],
      },
    };
    expect(() =>
      buildContractDefinition({
        family: familyPack,
        target: targetPack,
        extensions: { 'uuid-codec-pack': uuidCodecPack },
        createNamespace: createTestSqlNamespace,
        ...testTypeLookups,
        models: {},
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Generator "uuidv4" is registered by both "postgres" and "uuid-codec-pack". Register each generator once, in the component that defines it.',
      }),
    );
  });

  it('refuse a list field', () => {
    expect(() =>
      executionDefaultsOf({ tags: field.column(textColumn).many().onCreate(gen.uuid()) }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Field "Event.tags" is a list and cannot use .onCreate(uuid()). Lists have no per-element generated values; remove .onCreate(...).',
        meta: {
          modelName: 'Event',
          fieldName: 'tags',
          codecId: 'pg/text@1',
          function: 'uuid',
          reason: 'generator-on-list',
        },
      }),
    );
  });

  it('refuse a phase set twice', () => {
    expect(() => field.column(textColumn).onCreate(gen.uuid()).onCreate(gen.uuid(7))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: { reason: 'generator-phase-set-twice', phase: 'onCreate' },
      }),
    );
  });

  it('keep a database default beside a generator', () => {
    const definition = buildContractDefinition({
      family: familyPack,
      target: targetPack,
      extensions: { slugid: slugidPack },
      createNamespace: createTestSqlNamespace,
      ...testTypeLookups,
      models: {
        Event: model('Event', {
          fields: {
            id: field.column(textColumn).id().default('fallback').onCreate(gen.uuid()),
          },
        }),
      },
    });
    const id = definition.models[0]?.fields.find((node) => node.fieldName === 'id');
    expect({ default: id?.default, executionDefaults: id?.executionDefaults }).toEqual({
      default: { kind: 'literal', value: 'fallback' },
      executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
    });
  });
});
