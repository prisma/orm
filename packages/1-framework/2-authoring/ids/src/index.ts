import type { ExecutionMutationDefaultValue } from '@internal/contract/types';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import { ifDefined } from '@internal/utils/defined';
import { contractError } from './contract-errors';
import { type BuiltinGeneratorId, builtinGeneratorIds } from './generator-ids';
import type { IdGeneratorOptionsById } from './generators';

export { builtinGeneratorIds };

const GENERATED_CHAR_TYPE = { codecId: 'sql/char@1' } as const;

/**
 * The explicit storage a generator's TS spec helper bundles: a `character(N)`
 * type sized to the generator's output. Calling a helper *is* an explicit
 * storage request (the storage is part of the helper's contract), unlike a
 * PSL `@default(<generator>)`, which never influences the field's storage
 * type — the PSL interpreter never consults this metadata.
 */
type GeneratedStorage = {
  readonly type: ColumnTypeDescriptor<typeof GENERATED_CHAR_TYPE.codecId>;
  readonly typeParams: { readonly length: number };
};

function charStorage(length: number): GeneratedStorage {
  return { type: GENERATED_CHAR_TYPE, typeParams: { length } };
}

function nanoidStorage(params?: Record<string, unknown>): GeneratedStorage {
  const rawSize = params?.['size'];
  if (rawSize === undefined) {
    return charStorage(21);
  }
  if (typeof rawSize !== 'number' || !Number.isInteger(rawSize) || rawSize < 2 || rawSize > 255) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      'nanoid size must be an integer between 2 and 255',
      { meta: { helperPath: 'nanoid', paramName: 'size', received: rawSize } },
    );
  }
  return charStorage(rawSize);
}

type BuiltinGeneratorMetadata = {
  readonly applicableCodecIds: readonly string[];
  /** The single source of the {@link GeneratedStorage} this generator's TS spec helper bundles. */
  readonly generatedStorage: (params?: Record<string, unknown>) => GeneratedStorage;
};

const builtinGeneratorMetadataById = {
  ulid: {
    applicableCodecIds: ['pg/text@1', 'sql/char@1'],
    generatedStorage: () => charStorage(26),
  },
  nanoid: {
    applicableCodecIds: ['pg/text@1', 'sql/char@1'],
    generatedStorage: nanoidStorage,
  },
  uuidv7: {
    applicableCodecIds: ['pg/text@1', 'sql/char@1', 'pg/uuid@1'],
    generatedStorage: () => charStorage(36),
  },
  uuidv4: {
    applicableCodecIds: ['pg/text@1', 'sql/char@1', 'pg/uuid@1'],
    generatedStorage: () => charStorage(36),
  },
  cuid2: {
    applicableCodecIds: ['pg/text@1', 'sql/char@1'],
    generatedStorage: () => charStorage(24),
  },
  ksuid: {
    applicableCodecIds: ['pg/text@1', 'sql/char@1'],
    generatedStorage: () => charStorage(27),
  },
} as const satisfies Record<BuiltinGeneratorId, BuiltinGeneratorMetadata>;

export const builtinGeneratorRegistryMetadata: ReadonlyArray<{
  readonly id: BuiltinGeneratorId;
  readonly applicableCodecIds: readonly string[];
}> = builtinGeneratorIds.map((id) => ({
  id,
  applicableCodecIds: builtinGeneratorMetadataById[id].applicableCodecIds,
}));

export type GeneratedColumnSpec<TCodecId extends string = string> = {
  readonly type: ColumnTypeDescriptor<TCodecId>;
  readonly nullable?: false;
  readonly typeParams?: Record<string, unknown>;
  readonly generated: ExecutionMutationDefaultValue;
};

function createGeneratedSpec<TId extends BuiltinGeneratorId>(
  id: TId,
  options?: IdGeneratorOptionsById[TId],
): GeneratedColumnSpec<typeof GENERATED_CHAR_TYPE.codecId> {
  const params = options as Record<string, unknown> | undefined;
  const storage = builtinGeneratorMetadataById[id].generatedStorage(params);
  return {
    type: storage.type,
    nullable: false,
    typeParams: storage.typeParams,
    generated: {
      kind: 'generator',
      id,
      ...ifDefined('params', params),
    },
  };
}

export const ulid = (options?: IdGeneratorOptionsById['ulid']) =>
  createGeneratedSpec('ulid', options);
export const nanoid = (options?: IdGeneratorOptionsById['nanoid']) =>
  createGeneratedSpec('nanoid', options);
export const uuidv7 = (options?: IdGeneratorOptionsById['uuidv7']) =>
  createGeneratedSpec('uuidv7', options);
export const uuidv4 = (options?: IdGeneratorOptionsById['uuidv4']) =>
  createGeneratedSpec('uuidv4', options);
export const cuid2 = (options?: IdGeneratorOptionsById['cuid2']) =>
  createGeneratedSpec('cuid2', options);
export const ksuid = (options?: IdGeneratorOptionsById['ksuid']) =>
  createGeneratedSpec('ksuid', options);
