import type { DataTypeSupport } from '@internal/framework-components/authoring';
import type { DataTypeId } from '@internal/framework-components/codec';
import type {
  BindingResolution,
  GeneratorFunctionBinding,
  GeneratorFunctionContribution,
  MutationDefaultGeneratorDescriptor,
} from '@internal/framework-components/components';
import { singleGeneratorBinding } from '@internal/framework-components/components';
import {
  type BuiltinGeneratorId,
  CUID_VERSION,
  generatedLength,
  NANOID_SIZE,
  UUID_VERSIONS,
} from '@internal/ids';
import {
  type ArgType,
  type AttributeCtx,
  type DataTypeValueOptions,
  dataTypeValue,
  type FuncCallSig,
  leafDiagnostic,
  optional,
  refineArg,
} from '@internal/psl-parser';
import {
  SQL_CHAR_CODEC_ID,
  SQL_TEXT_CODEC_ID,
  SQL_VARCHAR_CODEC_ID,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok } from '@internal/utils/result';

const NANOID_DEFAULT_SIZE = 21;

const nowSignature = {
  documentation: "Writes the current time, as the column's codec represents it.",
} as const satisfies FuncCallSig;
const ulidSignature = {
  documentation: 'Generates a ULID when a value is not supplied.',
} as const satisfies FuncCallSig;
const ksuidSignature = {
  documentation: 'Generates a KSUID when a value is not supplied.',
} as const satisfies FuncCallSig;

function refused(message: string): BindingResolution {
  return { ok: false, message };
}

function generated(id: string, params?: Readonly<Record<string, unknown>>): BindingResolution {
  return {
    ok: true,
    generator: params === undefined ? { kind: 'generator', id } : { kind: 'generator', id, params },
  };
}

function uuidBinding(codecIds: readonly string[]): GeneratorFunctionBinding {
  return {
    codecIds,
    generatorIds: ['uuidv4', 'uuidv7'],
    resolve: ({ args }) => {
      const version = args['version'];
      if (version === undefined || version === UUID_VERSIONS.v4) return generated('uuidv4');
      if (version === UUID_VERSIONS.v7) return generated('uuidv7');
      return refused(
        `uuid: version must be ${UUID_VERSIONS.v4} or ${UUID_VERSIONS.v7}, got ${String(version)}`,
      );
    },
    printArguments: (generator) => {
      if (generator.id === 'uuidv4') return { args: {}, text: '' };
      if (generator.id === 'uuidv7') {
        return { args: { version: UUID_VERSIONS.v7 }, text: String(UUID_VERSIONS.v7) };
      }
      return undefined;
    },
  };
}

function cuidBinding(codecIds: readonly string[]): GeneratorFunctionBinding {
  return {
    codecIds,
    generatorIds: ['cuid2'],
    resolve: ({ args }) => {
      const version = args['version'];
      return version === CUID_VERSION
        ? generated('cuid2')
        : refused(`cuid: version must be ${CUID_VERSION}, got ${String(version)}`);
    },
    printArguments: (generator) =>
      generator.id === 'cuid2'
        ? { args: { version: CUID_VERSION }, text: String(CUID_VERSION) }
        : undefined,
  };
}

function isNanoidSize(size: unknown): size is number {
  return (
    typeof size === 'number' &&
    Number.isInteger(size) &&
    size >= NANOID_SIZE.min &&
    size <= NANOID_SIZE.max
  );
}

/**
 * A Nano ID has the size the call gives, or 21; the column's length never sets it. A shorter identifier in a fixed-length column is padded by the database, as Prisma 7 does.
 */
function nanoidBinding(codecIds: readonly string[]): GeneratorFunctionBinding {
  return {
    codecIds,
    generatorIds: ['nanoid'],
    resolve: ({ args }) => {
      const explicit = args['size'];
      if (explicit !== undefined && !isNanoidSize(explicit)) {
        return refused(
          `nanoid: size must be between ${NANOID_SIZE.min} and ${NANOID_SIZE.max}, got ${String(explicit)}`,
        );
      }
      return explicit === undefined ? generated('nanoid') : generated('nanoid', { size: explicit });
    },
    printArguments: (generator) => {
      if (generator.id !== 'nanoid') return undefined;
      const size = generator.params?.['size'];
      return typeof size === 'number'
        ? { args: { size }, text: String(size) }
        : { args: {}, text: '' };
    },
  };
}

/**
 * `binding`, refusing a column whose length, in its data type's normal form, is shorter than the identifier the generator writes. The database would refuse every insert of a longer value.
 */
function fittingColumn(name: string, binding: GeneratorFunctionBinding): GeneratorFunctionBinding {
  return {
    ...binding,
    resolve: (input) => {
      const resolution = binding.resolve(input);
      const length = input.field.length;
      if (!resolution.ok || length === undefined) return resolution;
      const { generator } = resolution;
      const written = generatedLength(
        blindCast<BuiltinGeneratorId, 'an identifier binding produces only built-in generators'>(
          generator.id,
        ),
        generator.params,
      );
      if (written <= length) return resolution;
      const call = `${name}(${binding.printArguments(generator, input.field)?.text ?? ''})`;
      return refused(
        `${call} writes ${written} characters, which does not fit a column of ${length} ${length === 1 ? 'character' : 'characters'}.`,
      );
    },
  };
}

/** The identifier generator functions bound to a target's text codecs, and `uuid` to its uuid codecs. Each refuses a column too short for what it writes. */
export function idGeneratorFunctionBindings(codecs: {
  readonly text: readonly string[];
  readonly uuid?: readonly string[];
}): readonly GeneratorFunctionContribution[] {
  const { text } = codecs;
  return [
    {
      name: 'uuid',
      bindings: [fittingColumn('uuid', uuidBinding([...text, ...(codecs.uuid ?? [])]))],
    },
    { name: 'cuid', bindings: [fittingColumn('cuid', cuidBinding(text))] },
    {
      name: 'ulid',
      bindings: [
        fittingColumn('ulid', singleGeneratorBinding({ codecIds: text, generatorId: 'ulid' })),
      ],
    },
    {
      name: 'ksuid',
      bindings: [
        fittingColumn('ksuid', singleGeneratorBinding({ codecIds: text, generatorId: 'ksuid' })),
      ],
    },
    { name: 'nanoid', bindings: [fittingColumn('nanoid', nanoidBinding(text))] },
  ];
}

const familyIdBindings = idGeneratorFunctionBindings({
  text: [SQL_CHAR_CODEC_ID, SQL_VARCHAR_CODEC_ID, SQL_TEXT_CODEC_ID],
});

function familyBindingsOf(name: string): readonly GeneratorFunctionBinding[] {
  return familyIdBindings.find((contribution) => contribution.name === name)?.bindings ?? [];
}

/** The generator functions the SQL family declares, with their bindings to the family's codecs. Targets bind `now` and their own codecs. */
export const sqlFamilyGeneratorFunctions = [
  { name: 'now', signature: nowSignature, bindings: [] },
  { name: 'uuid', bindings: familyBindingsOf('uuid') },
  { name: 'cuid', bindings: familyBindingsOf('cuid') },
  { name: 'ulid', signature: ulidSignature, bindings: familyBindingsOf('ulid') },
  { name: 'nanoid', bindings: familyBindingsOf('nanoid') },
  { name: 'ksuid', signature: ksuidSignature, bindings: familyBindingsOf('ksuid') },
] as const satisfies readonly GeneratorFunctionContribution[];

/** The identifier generators the family's bindings produce, which the family registers so that a target binding them through `idGeneratorFunctionBindings` registers none. */
export const sqlFamilyGeneratorDescriptors: readonly MutationDefaultGeneratorDescriptor[] = [
  ...new Set(
    sqlFamilyGeneratorFunctions.flatMap(({ bindings }) =>
      bindings.flatMap(({ generatorIds }) => generatorIds),
    ),
  ),
].map((id) => ({ id }));

/**
 * The generator functions whose arguments are integers, declared with their signatures: `uuid(version?)`, `cuid(version)` and `nanoid(size?)`. Each argument is a value of `integer`, the target's integer data type, read and cast like a default, then checked by its function. A target declares them, because only it knows its integer type; the family and the target bind them.
 */
export function sqlIntegerArgumentGeneratorFunctions({
  integer,
}: {
  readonly integer: DataTypeId;
}) {
  return [
    {
      name: 'uuid',
      signature: (dataTypes: DataTypeSupport) => uuidSignature(integer, dataTypes),
      bindings: [],
    },
    {
      name: 'cuid',
      signature: (dataTypes: DataTypeSupport) => cuidSignature(integer, dataTypes),
      bindings: [],
    },
    {
      name: 'nanoid',
      signature: (dataTypes: DataTypeSupport) => nanoidSignature(integer, dataTypes),
      bindings: [],
    },
  ] as const satisfies readonly GeneratorFunctionContribution[];
}

function uuidSignature(integer: DataTypeId, dataTypes: DataTypeSupport) {
  const versions = [UUID_VERSIONS.v4, UUID_VERSIONS.v7] as const;
  return {
    documentation: 'Generates a UUID when a value is not supplied.',
    positional: [
      {
        key: 'version',
        type: optional(
          checkedInteger<(typeof versions)[number]>(
            integer,
            dataTypes,
            listed(versions),
            (version, written) =>
              versions.some((allowed) => allowed === version)
                ? undefined
                : `uuid: version must be ${UUID_VERSIONS.v4} or ${UUID_VERSIONS.v7}, got ${written}`,
          ),
        ),
        documentation: `The UUID version: \`${UUID_VERSIONS.v4}\` or \`${UUID_VERSIONS.v7}\`. Defaults to \`${UUID_VERSIONS.v4}\`.`,
      },
    ],
  } as const satisfies FuncCallSig;
}

function cuidSignature(integer: DataTypeId, dataTypes: DataTypeSupport) {
  return {
    documentation: 'Generates a CUID2 identifier when a value is not supplied.',
    positional: [
      {
        key: 'version',
        type: checkedInteger<typeof CUID_VERSION>(
          integer,
          dataTypes,
          listed([CUID_VERSION]),
          (version, written) =>
            version === CUID_VERSION
              ? undefined
              : `cuid: version must be ${CUID_VERSION}, got ${written}`,
        ),
        documentation: `The CUID version. Only \`${CUID_VERSION}\` is supported.`,
      },
    ],
  } as const satisfies FuncCallSig;
}

function nanoidSignature(integer: DataTypeId, dataTypes: DataTypeSupport) {
  return {
    documentation: 'Generates a Nano ID when a value is not supplied.',
    positional: [
      {
        key: 'size',
        type: optional(
          checkedInteger<number>(
            integer,
            dataTypes,
            { label: `integer from ${NANOID_SIZE.min} to ${NANOID_SIZE.max}`, suggestions: [] },
            (size, written) =>
              isNanoidSize(size)
                ? undefined
                : `nanoid: size must be between ${NANOID_SIZE.min} and ${NANOID_SIZE.max}, got ${written}`,
          ),
        ),
        documentation: `The identifier length, from \`${NANOID_SIZE.min}\` through \`${NANOID_SIZE.max}\`. Defaults to ${NANOID_DEFAULT_SIZE}.`,
      },
    ],
  } as const satisfies FuncCallSig;
}

/** The completion suggestions of an argument that takes one of `values`, which its label lists. */
function listed(values: readonly number[]): DataTypeValueOptions {
  return { suggestions: values.map(String), labelIsUnion: true };
}

/**
 * One value of the integer data type, as a number, refused at the argument with the function's message when `refusal` returns one.
 */
function checkedInteger<Allowed extends number>(
  integer: DataTypeId,
  dataTypes: DataTypeSupport,
  allowed: DataTypeValueOptions,
  refusal: (value: number, written: string) => string | undefined,
): ArgType<Allowed, AttributeCtx> {
  return refineArg(dataTypeValue(integer, dataTypes, allowed), ({ value }, arg, ctx) => {
    const stored = value.value;
    if (typeof stored !== 'number' && typeof stored !== 'string') {
      throw new InternalError(
        `Data type "${integer}" stores an integer as ${typeof stored}, not a number or digit text.`,
      );
    }
    const message = refusal(Number(stored), String(stored));
    return message === undefined
      ? ok(blindCast<Allowed, 'refusal accepts only the values the function takes'>(Number(stored)))
      : notOk([leafDiagnostic(ctx, arg, message, 'PSL_INVALID_GENERATOR_ARGUMENT')]);
  });
}
