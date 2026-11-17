import type { JsonValue } from '@internal/contract/types';
import { InternalError } from '@internal/utils/internal-error';
import type { CodecLookupWithDescriptors, CodecRef } from './codec-types';
import type { DataTypeId } from './data-type';
import { storedValueKey } from './enum-stored-members';
import {
  type DataTypeSupport,
  type RefusalDescription,
  readWrittenValueIntoCodec,
  type WrittenValue,
} from './written-value';

/** The field a model names as its discriminator, as the rule reads it. */
export interface DiscriminatorField {
  /** The field's codec; `undefined` for a field that has no scalar codec, such as a relation or a value object, which is not text. */
  readonly ref: CodecRef | undefined;
  readonly nullable: boolean;
  readonly many: boolean;
  /** The stored values of the members of the enum that types the field; `undefined` when no enum types it. */
  readonly enumMembers: readonly JsonValue[] | undefined;
}

/** Why a field cannot be a discriminator, or why a variant's discriminator value is refused. `Key` names the variant a value belongs to. */
export type DiscriminatorRefusal<Key> =
  | { readonly kind: 'optional' }
  | { readonly kind: 'list' }
  | {
      readonly kind: 'not-text';
      readonly dataType: DataTypeId | undefined;
      readonly textDataTypes: readonly DataTypeId[];
    }
  | {
      readonly kind: 'not-a-member';
      readonly key: Key;
      readonly stored: JsonValue;
      readonly members: readonly JsonValue[];
    };

/**
 * The refusals of a discriminator: the field must be required, hold one value, and have one of the stack's text data types; and when an enum types it, each variant's value, as the field stores it, must be one of the enum's members, compared by the field's data type's equality. Returns no refusals for a discriminator that is valid.
 */
export function discriminatorRefusals<Key>(input: {
  readonly field: DiscriminatorField;
  readonly variantValues: readonly { readonly key: Key; readonly stored: JsonValue }[];
  readonly codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'>;
  readonly dataTypes: Pick<DataTypeSupport, 'lookup' | 'textDataTypes'>;
}): readonly DiscriminatorRefusal<Key>[] {
  const { field } = input;
  const textDataTypes = input.dataTypes.textDataTypes ?? [];
  if (textDataTypes.length === 0) {
    throw new InternalError(
      'The stack names no text data types, so no field can be a discriminator; the target names its text types in its authoring contributions.',
    );
  }
  const refusals: DiscriminatorRefusal<Key>[] = [];
  if (field.nullable) refusals.push({ kind: 'optional' });
  if (field.many) refusals.push({ kind: 'list' });
  const dataType =
    field.ref === undefined
      ? undefined
      : input.codecLookup.descriptorFor(field.ref.codecId)?.dataType;
  if (dataType === undefined || !textDataTypes.includes(dataType)) {
    refusals.push({ kind: 'not-text', dataType, textDataTypes });
  }
  const members = field.enumMembers;
  if (members !== undefined) {
    const equalityKey =
      dataType === undefined ? undefined : input.dataTypes.lookup.get(dataType)?.equalityKey;
    const memberKeys = new Set(members.map((member) => storedValueKey(member, equalityKey)));
    for (const { key, stored } of input.variantValues) {
      if (!memberKeys.has(storedValueKey(stored, equalityKey))) {
        refusals.push({ kind: 'not-a-member', key, stored, members });
      }
    }
  }
  return refusals;
}

/**
 * A discriminator refusal worded as a PSL diagnostic: a refusal of the field at its `@@discriminator`, and a value that is not a member at its `@@base`. The wording names PSL syntax, so PSL sources word the refusals with this; a TypeScript source words them in its own terms.
 */
export function describeDiscriminatorRefusal<Key>(
  refusal: DiscriminatorRefusal<Key>,
  subject: {
    readonly modelName: string;
    readonly fieldName: string;
    /** How the field's type is written, as in `Int`. */
    readonly typeName: string;
    /** The enum that types the field, for a value that is not one of its members. */
    readonly enumName: string | undefined;
    readonly variantName: (key: Key) => string;
  },
): string {
  const field = `Discriminator field "${subject.fieldName}" on model "${subject.modelName}"`;
  switch (refusal.kind) {
    case 'optional':
      return `${field} must be required, but it is optional. Remove the "?"`;
    case 'list':
      return `${field} must hold one value, but it is a list. Remove the "[]"`;
    case 'not-text':
      return `${field} must be text, such as String, but is "${subject.typeName}"`;
    case 'not-a-member':
      return `Model "${subject.variantName(refusal.key)}" declares @@base value ${JSON.stringify(refusal.stored)}, which is not a member of enum "${subject.enumName}", the type of discriminator field "${subject.modelName}.${subject.fieldName}". Write one of: ${refusal.members.map((member) => JSON.stringify(member)).join(', ')}`;
  }
}

/** A refusal of the discriminator field itself, which leaves no variant value to read. */
export type DiscriminatorFieldRefusal = Exclude<
  DiscriminatorRefusal<never>,
  { readonly kind: 'not-a-member' }
>;

/** Why one variant's discriminator value is refused: it cannot be read into the field's codec, or it is not a member of the field's enum. */
export type DiscriminatorVariantRefusal<Key> =
  | { readonly kind: 'unreadable'; readonly key: Key; readonly refusal: RefusalDescription }
  | Extract<DiscriminatorRefusal<Key>, { readonly kind: 'not-a-member' }>;

/** What the discriminator rule decides for one discriminator and its variants. */
export interface DiscriminatorDecision<Key> {
  /** Refusals of the field; when there are any, no variant value is read and there are no values. */
  readonly fieldRefusals: readonly DiscriminatorFieldRefusal[];
  /** Each refused variant value, in the order of the variants. */
  readonly variantRefusals: readonly DiscriminatorVariantRefusal<Key>[];
  /** Each accepted variant's value, as the field stores it. */
  readonly values: ReadonlyMap<Key, string>;
}

/**
 * Applies the discriminator rule to one discriminator and its variants: reads each variant's written value into the field's codec with {@link readWrittenValueIntoCodec}, worded after `subject`, then decides with {@link discriminatorRefusals}. A refused field refuses the whole discriminator, so its variants' values are neither read nor refused. A discriminator is text, so a stored value that is not a string is a bug in a text data type.
 */
export function applyDiscriminatorRule<Key>(input: {
  readonly field: DiscriminatorField;
  readonly variants: readonly { readonly key: Key; readonly written: WrittenValue }[];
  readonly subject: string;
  readonly codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'>;
  readonly dataTypes: DataTypeSupport;
}): DiscriminatorDecision<Key> {
  const { field, codecLookup, dataTypes } = input;
  const fieldOnly = discriminatorRefusals<Key>({
    field,
    variantValues: [],
    codecLookup,
    dataTypes,
  }).filter(isFieldRefusal);
  if (fieldOnly.length > 0) {
    return { fieldRefusals: fieldOnly, variantRefusals: [], values: new Map() };
  }
  const ref = field.ref;
  if (ref === undefined) {
    throw new InternalError('A discriminator field the rule accepts has a codec.');
  }
  const reads = input.variants.map(({ key, written }) => ({
    key,
    reading: readWrittenValueIntoCodec({
      support: dataTypes,
      codecLookup,
      ref,
      written,
      subject: input.subject,
    }),
  }));
  const notMembers = new Map(
    discriminatorRefusals({
      field,
      variantValues: reads.flatMap(({ key, reading }) =>
        reading.ok ? [{ key, stored: reading.value }] : [],
      ),
      codecLookup,
      dataTypes,
    }).flatMap((refusal) => (refusal.kind === 'not-a-member' ? [[refusal.key, refusal]] : [])),
  );
  const variantRefusals: DiscriminatorVariantRefusal<Key>[] = [];
  const values = new Map<Key, string>();
  for (const { key, reading } of reads) {
    if (!reading.ok) {
      variantRefusals.push({ kind: 'unreadable', key, refusal: reading.failure });
      continue;
    }
    const notMember = notMembers.get(key);
    if (notMember !== undefined) {
      variantRefusals.push(notMember);
      continue;
    }
    if (typeof reading.value !== 'string') {
      throw new InternalError(
        `Discriminator field codec "${ref.codecId}" stores a text value as ${typeof reading.value}.`,
      );
    }
    values.set(key, reading.value);
  }
  return { fieldRefusals: [], variantRefusals, values };
}

function isFieldRefusal<Key>(
  refusal: DiscriminatorRefusal<Key>,
): refusal is Exclude<DiscriminatorRefusal<Key>, { readonly kind: 'not-a-member' }> {
  return refusal.kind !== 'not-a-member';
}
