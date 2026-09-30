import type { ExecutionMutationDefaultValue } from '@internal/contract/types';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import type {
  ControlMutationDefaultEntry,
  DefaultFunctionLoweringContext,
  LoweredDefaultResult,
  MutationDefaultGeneratorDescriptor,
  TypedDefaultFunctionCall,
} from '@internal/framework-components/control';
import { timestampNowControlDescriptor } from '@internal/framework-components/control';
import { builtinGeneratorRegistryMetadata } from '@internal/ids';
import type { FuncCallSig } from '@internal/psl-parser';
import { int, num, oneOf, optional } from '@internal/psl-parser';
import {
  instantNowControlDescriptor,
  plainDateTimeNowControlDescriptor,
  postgresNativeAuthoringTypes,
  postgresScalarAuthoringTypes,
} from '@internal/target-postgres/control';

function executionGenerator(
  id: ExecutionMutationDefaultValue['id'],
  params?: Record<string, unknown>,
): LoweredDefaultResult {
  return {
    ok: true,
    value: {
      kind: 'execution',
      generated: {
        kind: 'generator',
        id,
        ...(params ? { params } : {}),
      },
    },
  };
}

function lowerAutoincrement(): LoweredDefaultResult {
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: { kind: 'function', expression: 'autoincrement()' },
    },
  };
}

function lowerNow(): LoweredDefaultResult {
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: { kind: 'function', expression: 'now()' },
    },
  };
}

function lowerUlid(): LoweredDefaultResult {
  return executionGenerator('ulid');
}

function lowerUuid(input: {
  readonly call: TypedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  return input.call.args['version'] === 7
    ? executionGenerator('uuidv7')
    : executionGenerator('uuidv4');
}

function lowerCuid(): LoweredDefaultResult {
  return executionGenerator('cuid2');
}

function lowerNanoid(input: {
  readonly call: TypedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const size = input.call.args['size'];
  return typeof size === 'number'
    ? executionGenerator('nanoid', { size })
    : executionGenerator('nanoid');
}

const nowSig: FuncCallSig = {
  documentation: 'Uses the current database timestamp as the default value.',
};
const autoincrementSig: FuncCallSig = {
  documentation: 'Generates an increasing integer value in the database.',
};
const ulidSig: FuncCallSig = { documentation: 'Generates a ULID when a value is not supplied.' };
const uuidSig: FuncCallSig = {
  documentation: 'Generates a UUID when a value is not supplied.',
  positional: [
    {
      key: 'version',
      type: optional(oneOf(num(4), num(7))),
      documentation: 'The UUID version: `4` or `7`. Defaults to `4`.',
    },
  ],
};
const cuidSig: FuncCallSig = {
  documentation: 'Generates a CUID2 identifier when a value is not supplied.',
  positional: [
    { key: 'version', type: num(2), documentation: 'The CUID version. Only `2` is supported.' },
  ],
};
const nanoidSig: FuncCallSig = {
  documentation: 'Generates a Nano ID when a value is not supplied.',
  positional: [
    {
      key: 'size',
      type: optional(int({ min: 2, max: 255 })),
      documentation:
        'The identifier length, from `2` through `255`. Omit to use the generator default.',
    },
  ],
};
const postgresDefaultFunctionRegistryEntries = [
  [
    'autoincrement',
    {
      signature: autoincrementSig,
      lower: lowerAutoincrement,
      usageSignatures: ['autoincrement()'],
    },
  ],
  ['now', { signature: nowSig, lower: lowerNow, usageSignatures: ['now()'] }],
  [
    'uuid',
    { signature: uuidSig, lower: lowerUuid, usageSignatures: ['uuid()', 'uuid(4)', 'uuid(7)'] },
  ],
  ['cuid', { signature: cuidSig, lower: lowerCuid, usageSignatures: ['cuid(2)'] }],
  ['ulid', { signature: ulidSig, lower: lowerUlid, usageSignatures: ['ulid()'] }],
  [
    'nanoid',
    { signature: nanoidSig, lower: lowerNanoid, usageSignatures: ['nanoid()', 'nanoid(<2-255>)'] },
  ],
] satisfies ReadonlyArray<readonly [string, ControlMutationDefaultEntry]>;

export const postgresAuthoringTypes = {
  ...postgresScalarAuthoringTypes,
  ...postgresNativeAuthoringTypes,
} as const satisfies AuthoringTypeNamespace;

export function createPostgresDefaultFunctionRegistry(): ReadonlyMap<
  string,
  ControlMutationDefaultEntry
> {
  return new Map(postgresDefaultFunctionRegistryEntries);
}

export function createPostgresMutationDefaultGeneratorDescriptors(): readonly MutationDefaultGeneratorDescriptor[] {
  return [
    ...builtinGeneratorRegistryMetadata.map(
      ({ id, applicableCodecIds }): MutationDefaultGeneratorDescriptor => ({
        id,
        applicableCodecIds,
      }),
    ),
    timestampNowControlDescriptor(),
    instantNowControlDescriptor(),
    plainDateTimeNowControlDescriptor(),
  ];
}
