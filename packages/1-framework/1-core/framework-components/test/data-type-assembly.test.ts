import { InternalError } from '@internal/utils/internal-error';
import { type Type, type } from 'arktype';
import { describe, expect, it } from 'vitest';
import type { CreateControlStackInput } from '../src/control/control-stack';
import { createControlStack, enforceHelperCodecInvariants } from '../src/control/control-stack';
import type { AnyCodecDescriptor } from '../src/shared/codec-descriptor';
import {
  assembleDataTypes,
  type DataType,
  type DataTypeId,
  dataType,
  dataTypeId,
} from '../src/shared/data-type';
import {
  assembleAuthoringDataTypes,
  assembleDataTypeSupport,
  type ContributedHelper,
  type DataTypeComponent,
  enforceDataTypeAssemblyInvariants,
} from '../src/shared/data-type-support';
import type { AuthoringTypeConstructorDescriptor } from '../src/shared/framework-authoring';
import { isRuntimeError } from '../src/shared/runtime-error';

const int2 = dataType('demo/int2', { read: (json) => json });
const int8 = dataType('demo/int8', {
  read: (json) => json,
  casts: { [int2.id]: (value) => String(value) },
});
const text = dataType('demo/text', { read: (json) => json });
const sized = dataType('demo/sized', {
  read: (json) => json,
  params: type({ 'length?': 'number.integer >= 1' }),
});

const codecDescriptors: Readonly<
  Record<
    string,
    Pick<AnyCodecDescriptor, 'dataType'> & { readonly paramsSchema?: Type<unknown> | undefined }
  >
> = {
  'demo/text@1': { dataType: text.id },
  'demo/also-text@1': { dataType: text.id },
  'demo/sized@1': { dataType: sized.id, paramsSchema: sized.params },
  'demo/sized-plain@1': { dataType: sized.id },
  'demo/labelled@1': {
    dataType: sized.id,
    paramsSchema: type({ 'length?': 'number.integer >= 1', 'label?': 'string' }),
  },
};

const codecDescriptorFor = (codecId: string) => {
  const descriptor = codecDescriptors[codecId];
  return descriptor === undefined
    ? undefined
    : { dataType: descriptor.dataType, paramsSchema: descriptor.paramsSchema };
};

const constructorNamed = (
  path: string,
  codecId: string,
  options: { readonly inferred?: true; readonly typeParamKey?: string } = {},
) => ({
  path,
  contributedBy: 'x-pack',
  descriptor: {
    kind: 'typeConstructor' as const,
    ...(options.inferred === undefined ? {} : { inferred: options.inferred }),
    ...(options.typeParamKey === undefined
      ? { output: { codecId } }
      : {
          args: [{ kind: 'value' as const, dataType: 'demo/int2', name: 'n', optional: true }],
          output: {
            codecId,
            typeParams: { [options.typeParamKey]: { kind: 'arg' as const, index: 0 } },
          },
        }),
  },
});

const contributor = (id: string, dataTypes: readonly DataType[]) => ({ id, dataTypes });

const numberEntry = (types: readonly DataTypeId[] = [int2.id]) =>
  ({
    written: {
      kind: 'plain',
      syntax: 'number',
      types,
      classify: () => ({ type: int2.id, value: 0 }),
    },
    print: String,
    documentation: 'A number.',
  }) as const;

const tagEntry = (tag: string) =>
  ({
    written: { kind: 'tag', tag, parse: (text_: string) => text_ },
    print: String,
    documentation: `A ${tag} body.`,
  }) as const;

const codec = (codecId: string, type: DataType) => ({ codecId, dataType: type.id });

const demoLookup = assembleDataTypes([contributor('demo', [int2, int8, text, sized])]).lookup;

const invariants = (overrides: Partial<Parameters<typeof enforceDataTypeAssemblyInvariants>[0]>) =>
  enforceDataTypeAssemblyInvariants({
    lookup: demoLookup,
    declaredTypes: [{ type: int2, contributedBy: 'demo' }],
    codecs: [],
    authoringEntries: [],
    textDataTypes: [],
    ...overrides,
  });

describe('assembleDataTypes', () => {
  it('collects every contributor’s types into one lookup', () => {
    const { lookup } = assembleDataTypes([
      contributor('demo', [int2]),
      contributor('other', [text]),
    ]);
    expect([lookup.has(int2.id), lookup.has(text.id)]).toEqual([true, true]);
  });

  it('lists the types in assembly order: contributor by contributor, each in its own order', () => {
    const { declared } = assembleDataTypes([
      contributor('demo', [int8, int2]),
      contributor('other', [text]),
    ]);
    expect(declared).toEqual([
      { type: int8, contributedBy: 'demo' },
      { type: int2, contributedBy: 'demo' },
      { type: text, contributedBy: 'other' },
    ]);
  });

  it('holds nothing when no contributor registers a type', () => {
    expect(assembleDataTypes([{ id: 'demo' }]).declared).toEqual([]);
  });

  it('refuses two declarations of one id, naming both contributors', () => {
    expect(() =>
      assembleDataTypes([
        contributor('demo', [int2]),
        contributor('other', [dataType('demo/int2', { read: (json) => json })]),
      ]),
    ).toThrow(/"other".*"demo"|"demo".*"other"/);
  });
});

describe('enforceDataTypeAssemblyInvariants', () => {
  it('refuses a codec whose data type nobody registered, naming the contributor and the id', () => {
    expect(() =>
      invariants({
        codecs: [
          {
            ...codec('demo/x@1', dataType('demo/gone', { read: (json) => json })),
            contributedBy: 'x-pack',
          },
        ],
      }),
    ).toThrow(/x-pack.*demo\/gone|demo\/gone.*x-pack/s);
  });

  it('refuses an authoring entry for a data type nobody registered', () => {
    expect(() =>
      invariants({
        authoringEntries: [{ key: 'demo/gone', entry: tagEntry('gone'), contributedBy: 'x-pack' }],
      }),
    ).toThrow(/x-pack.*demo\/gone|demo\/gone.*x-pack/s);
  });

  it('refuses an authoring entry under a key that is not a registered data type id', () => {
    expect(() =>
      invariants({
        authoringEntries: [
          { key: 'lowering:sql', entry: tagEntry('sql'), contributedBy: 'x-pack' },
        ],
      }),
    ).toThrow(/x-pack.*lowering:sql|lowering:sql.*x-pack/s);
  });

  it('refuses a classifier that returns a data type nobody registered', () => {
    expect(() =>
      invariants({
        authoringEntries: [
          {
            key: int2.id,
            entry: numberEntry([int2.id, dataTypeId('demo/gone')]),
            contributedBy: 'x-pack',
          },
        ],
      }),
    ).toThrow(/x-pack.*demo\/gone|demo\/gone.*x-pack/s);
  });

  it('refuses a cast from a data type nobody registered', () => {
    const casting = dataType('demo/casting', {
      read: (json) => json,
      casts: { 'demo/gone': (value) => value },
    });
    expect(() =>
      invariants({ declaredTypes: [{ type: casting, contributedBy: 'x-pack' }] }),
    ).toThrow(/demo\/gone/);
  });

  it('refuses two entries claiming one tag', () => {
    expect(() =>
      invariants({
        authoringEntries: [
          { key: int2.id, entry: tagEntry('json'), contributedBy: 'one' },
          { key: text.id, entry: tagEntry('json'), contributedBy: 'two' },
        ],
      }),
    ).toThrow(/"one".*"two"|"two".*"one"/s);
  });

  it('refuses two entries claiming one plain kind', () => {
    expect(() =>
      invariants({
        authoringEntries: [
          { key: int2.id, entry: numberEntry(), contributedBy: 'one' },
          { key: int8.id, entry: numberEntry(), contributedBy: 'two' },
        ],
      }),
    ).toThrow(/"one".*"two"|"two".*"one"/s);
  });

  it('refuses a cast from a data type no contract source can write', () => {
    expect(() =>
      invariants({
        declaredTypes: [{ type: int8, contributedBy: 'demo' }],
        authoringEntries: [{ key: int8.id, entry: tagEntry('int8'), contributedBy: 'demo' }],
      }),
    ).toThrow(/demo\/int2/);
  });

  it('passes a stack whose cast source can be written', () => {
    expect(() =>
      invariants({
        declaredTypes: [{ type: int8, contributedBy: 'demo' }],
        authoringEntries: [
          { key: int8.id, entry: tagEntry('int8'), contributedBy: 'demo' },
          { key: int2.id, entry: numberEntry(), contributedBy: 'demo' },
        ],
      }),
    ).not.toThrow();
  });

  it('raises a structured error', () => {
    try {
      invariants({
        codecs: [
          {
            ...codec('demo/x@1', dataType('demo/gone', { read: (json) => json })),
            contributedBy: 'x',
          },
        ],
      });
      expect.unreachable();
    } catch (error) {
      expect(isRuntimeError(error) && error.code).toBe('CONTRACT.DATA_TYPE_UNREGISTERED');
    }
  });
});

describe('enforceHelperCodecInvariants on type constructors', () => {
  const check = (helpers: readonly ContributedHelper[]) => () =>
    enforceHelperCodecInvariants({ lookup: demoLookup, helpers, codecDescriptorFor });

  it('refuses a type constructor naming a codec nobody registered, naming the contributor and the id', () => {
    expect(check([constructorNamed('Gone', 'demo/gone@1')])).toThrow(InternalError);
    expect(check([constructorNamed('Gone', 'demo/gone@1')])).toThrow(
      /x-pack.*demo\/gone@1|demo\/gone@1.*x-pack/s,
    );
  });

  it('passes constructors whose codecs are registered', () => {
    expect(check([constructorNamed('Text', 'demo/text@1')])).not.toThrow();
  });

  it('refuses a constructor mapping an argument onto a key neither the data type nor the codec declares', () => {
    expect(check([constructorNamed('Sized', 'demo/sized@1', { typeParamKey: 'width' })])).toThrow(
      /Sized.*x-pack.*width/s,
    );
  });

  it('refuses an argument mapped onto a key of a codec with no parameter schema and a data type without params', () => {
    expect(check([constructorNamed('Text', 'demo/text@1', { typeParamKey: 'length' })])).toThrow(
      /Text.*x-pack.*length/s,
    );
  });

  it('checks a codec with no parameter schema against its data type’s params', () => {
    expect(
      check([constructorNamed('Sized', 'demo/sized-plain@1', { typeParamKey: 'length' })]),
    ).not.toThrow();
    expect(
      check([constructorNamed('Sized', 'demo/sized-plain@1', { typeParamKey: 'width' })]),
    ).toThrow(/width/);
  });

  it('passes a constructor mapping an argument onto a key of the data type', () => {
    expect(
      check([constructorNamed('Sized', 'demo/sized@1', { typeParamKey: 'length' })]),
    ).not.toThrow();
  });

  it('passes a constructor mapping an argument onto a key only the codec declares', () => {
    expect(
      check([constructorNamed('Labelled', 'demo/labelled@1', { typeParamKey: 'label' })]),
    ).not.toThrow();
  });

  it('refuses two constructors of one data type both marked inferred, naming the contributor and the id', () => {
    expect(
      check([
        constructorNamed('Text', 'demo/text@1', { inferred: true }),
        constructorNamed('AlsoText', 'demo/also-text@1', { inferred: true }),
      ]),
    ).toThrow(/x-pack.*demo\/text|demo\/text.*x-pack/s);
  });

  it('passes one inferred constructor per data type', () => {
    expect(
      check([
        constructorNamed('Text', 'demo/text@1', { inferred: true }),
        constructorNamed('AlsoText', 'demo/also-text@1'),
        constructorNamed('Sized', 'demo/sized@1', { inferred: true }),
      ]),
    ).not.toThrow();
  });
});

describe('assembleDataTypeSupport', () => {
  const sizedConstructor = (dataTypeOfArgument: string) => ({
    kind: 'typeConstructor' as const,
    args: [{ kind: 'value' as const, dataType: dataTypeOfArgument, name: 'length' }],
    output: {
      codecId: 'demo/sized@1',
      typeParams: { length: { kind: 'arg' as const, index: 0 } },
    },
  });
  const demo: DataTypeComponent = {
    id: 'demo',
    dataTypes: [int2, int8, text, sized],
    authoring: { dataTypes: { [int2.id]: numberEntry() } },
  };
  const assemble =
    (...components: readonly DataTypeComponent[]) =>
    () =>
      assembleDataTypeSupport([demo, ...components], () => undefined);
  const thrownBy = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return isRuntimeError(error) ? { code: error.code, message: error.message } : error;
    }
    return undefined;
  };

  it('holds every component’s data types and authoring entries', () => {
    const { support, declared } = assembleDataTypeSupport(
      [demo, { id: 'other', authoring: { dataTypes: { [text.id]: tagEntry('sql') } } }],
      (codecId) => (codecId === 'demo/text@1' ? text.id : undefined),
    );
    expect({
      entries: Object.keys(support.entries),
      types: declared.map(({ type, contributedBy }) => [type.id, contributedBy]),
      codecDataType: support.dataTypeOfCodec('demo/text@1'),
    }).toEqual({
      entries: [int2.id, text.id],
      types: [
        [int2.id, 'demo'],
        [int8.id, 'demo'],
        [text.id, 'demo'],
        [sized.id, 'demo'],
      ],
      codecDataType: text.id,
    });
  });

  it('refuses two registrations of one data type', () => {
    expect(thrownBy(assemble({ id: 'other', dataTypes: [int2] }))).toMatchObject({
      code: 'CONTRACT.DATA_TYPE_DUPLICATE',
    });
  });

  it('refuses two entries for one data type, instead of keeping the last', () => {
    expect(
      thrownBy(assemble({ id: 'other', authoring: { dataTypes: { [int2.id]: numberEntry() } } })),
    ).toEqual({
      code: 'CONTRACT.DATA_TYPE_ENTRY_DUPLICATE',
      message:
        'Duplicate authoring entry for "demo/int2". Component "other" conflicts with "demo".',
    });
  });

  it('refuses a codec whose data type no component registers', () => {
    expect(
      thrownBy(
        assemble({
          id: 'x-pack',
          types: {
            codecTypes: {
              codecDescriptors: [{ codecId: 'x/gone@1', dataType: dataTypeId('demo/gone') }],
            },
          },
        }),
      ),
    ).toEqual({
      code: 'CONTRACT.DATA_TYPE_UNREGISTERED',
      message:
        'Codec "x/gone@1" names data type "demo/gone", which no component registers. Contributed by "x-pack".',
    });
  });

  it('holds every component’s text data types, each once', () => {
    const { support } = assembleDataTypeSupport(
      [
        { ...demo, authoring: { ...demo.authoring, textDataTypes: [text.id] } },
        { id: 'other', authoring: { textDataTypes: [text.id, sized.id] } },
      ],
      () => undefined,
    );
    expect(support.textDataTypes).toEqual([text.id, sized.id]);
  });

  it('refuses a text data type no component registers, naming the contributor', () => {
    expect(
      thrownBy(assemble({ id: 'x-pack', authoring: { textDataTypes: [dataTypeId('demo/gone')] } })),
    ).toEqual({
      code: 'CONTRACT.DATA_TYPE_UNREGISTERED',
      message:
        'The text data types names data type "demo/gone", which no component registers. Contributed by "x-pack".',
    });
  });

  it('refuses two entries claiming one written form', () => {
    expect(
      thrownBy(assemble({ id: 'x-pack', authoring: { dataTypes: { [int8.id]: numberEntry() } } })),
    ).toMatchObject({ code: 'CONTRACT.DATA_TYPE_WRITTEN_FORM_DUPLICATE' });
  });

  it('refuses a value argument of a data type no component registers, naming the constructor and the contributor', () => {
    expect(
      thrownBy(
        assemble({ id: 'x-pack', authoring: { type: { Sized: sizedConstructor('demo/gone') } } }),
      ),
    ).toEqual({
      code: 'CONTRACT.DATA_TYPE_UNREGISTERED',
      message:
        'Argument "length" of type constructor "Sized" names data type "demo/gone", which no component registers. Contributed by "x-pack".',
    });
  });

  it('refuses a type constructor argument that is not a value argument, saying how to declare it', () => {
    const numberArgument = {
      kind: 'typeConstructor',
      args: [{ kind: 'number', name: 'size', integer: true }],
      output: {
        codecId: 'demo/sized@1',
        typeParams: { length: { kind: 'arg', index: 0 } },
      },
    } as unknown as AuthoringTypeConstructorDescriptor;
    expect(
      thrownBy(
        assemble({
          id: 'x-pack',
          authoring: {
            type: {
              x: { Thing: numberArgument },
            },
          },
        }),
      ),
    ).toEqual({
      code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
      message:
        'Argument "size" of type constructor "x.Thing" contributed by "x-pack" is an argument of kind "number", but a type constructor\'s argument is a value of a data type. Declare it as { kind: \'value\', dataType: ... }, naming the data type its value belongs to.',
    });
  });

  it('refuses an unnamed type constructor argument by its position, with the documented payload', () => {
    const run = assemble({
      id: 'x-pack',
      authoring: {
        type: {
          Thing: {
            kind: 'typeConstructor',
            args: [{ kind: 'option', values: ['a'] }],
            output: { codecId: 'demo/sized@1' },
          } as unknown as AuthoringTypeConstructorDescriptor,
        },
      },
    });
    expect(run).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message: expect.stringMatching(
          /^Argument #1 of type constructor "Thing" contributed by "x-pack" is an argument of kind "option"/,
        ),
        details: {
          packId: 'x-pack',
          contribution: 'Thing',
          reason: 'type-constructor-argument-not-a-value',
        },
      }),
    );
  });

  it('refuses a value argument of a data type nothing in the components writes', () => {
    expect(
      thrownBy(
        assemble({ id: 'x-pack', authoring: { type: { Sized: sizedConstructor(text.id) } } }),
      ),
    ).toEqual({
      code: 'CONTRACT.DATA_TYPE_NOT_WRITABLE',
      message:
        'Argument "length" of type constructor "Sized" contributed by "x-pack" takes a value of data type "demo/text", which no contract source can write.',
    });
  });

  it('passes a value argument of a type that is written, or that casts from a type that is written', () => {
    expect(
      assemble({
        id: 'x-pack',
        authoring: {
          type: { Small: sizedConstructor(int2.id), Large: { nested: sizedConstructor(int8.id) } },
        },
      }),
    ).not.toThrow();
  });
});

describe('assembleAuthoringDataTypes', () => {
  it('merges every contributor’s entries, keyed by data type id', () => {
    const merged = assembleAuthoringDataTypes([
      { id: 'one', authoring: { dataTypes: { [int2.id]: numberEntry() } } },
      { id: 'two', authoring: { dataTypes: { [text.id]: tagEntry('sql') } } },
    ]);
    expect(Object.keys(merged).sort()).toEqual(['demo/int2', 'demo/text']);
  });

  it('refuses two contributors claiming one key', () => {
    expect(() =>
      assembleAuthoringDataTypes([
        { id: 'one', authoring: { dataTypes: { [int2.id]: numberEntry() } } },
        { id: 'two', authoring: { dataTypes: { [int2.id]: numberEntry() } } },
      ]),
    ).toThrow(/"one".*"two"|"two".*"one"/s);
  });
});

describe('createControlStack', () => {
  it('exposes every declared data type with its contributor, in stack order', () => {
    const uuid = dataType('demo/uuid', { read: (json) => json });
    const component = (kind: string, id: string, dataTypes: readonly DataType[]) => ({
      kind,
      id,
      version: '0.0.1',
      dataTypes,
    });
    const input = {
      family: component('family', 'fam', [text]),
      target: component('target', 'tgt', [int2]),
      adapter: component('adapter', 'adp', []),
      extensions: [component('extension', 'ext', [uuid])],
    } as unknown as CreateControlStackInput;

    expect(createControlStack(input).declaredDataTypes).toEqual([
      { type: text, contributedBy: 'fam' },
      { type: int2, contributedBy: 'tgt' },
      { type: uuid, contributedBy: 'ext' },
    ]);
  });

  it('exposes its data types with their authoring entries as one pair', () => {
    const input = {
      family: { kind: 'family', id: 'fam', version: '0.0.1', dataTypes: [int2] },
      target: {
        kind: 'target',
        id: 'tgt',
        version: '0.0.1',
        authoring: { dataTypes: { [int2.id]: numberEntry() } },
      },
      extensions: [],
    } as unknown as CreateControlStackInput;

    const stack = createControlStack(input);

    expect(stack.dataTypes.entries).toBe(stack.authoringContributions.dataTypes);
    expect(stack.dataTypes.lookup.get(int2.id)).toBe(int2);
    expect(Object.keys(stack.dataTypes.entries)).toEqual([int2.id]);
  });

  it('refuses a value argument of a data type no component registers', () => {
    const input = {
      family: { kind: 'family', id: 'fam', version: '0.0.1', dataTypes: [int2] },
      target: {
        kind: 'target',
        id: 'tgt',
        version: '0.0.1',
        authoring: {
          dataTypes: { [int2.id]: numberEntry() },
          type: {
            Sized: {
              kind: 'typeConstructor',
              args: [{ kind: 'value', dataType: 'demo/gone', name: 'length' }],
              output: { codecId: 'demo/sized@1' },
            },
          },
        },
      },
      extensions: [],
    } as unknown as CreateControlStackInput;

    expect(() => createControlStack(input)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.DATA_TYPE_UNREGISTERED' }),
    );
  });
});
