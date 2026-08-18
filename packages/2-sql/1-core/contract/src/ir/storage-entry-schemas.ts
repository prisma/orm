import { type Type, type } from 'arktype';
import type { ForeignKeyInput, ReferentialAction } from './foreign-key';
import type { ForeignKeyReferenceInput } from './foreign-key-reference';
import type { PrimaryKeyInput } from './primary-key';
import type { UniqueConstraintInput } from './unique-constraint';

type ColumnDefaultLiteral = {
  readonly kind: 'literal';
  readonly value: string | number | boolean | Record<string, unknown> | unknown[] | null;
};
type ColumnDefaultFunction = { readonly kind: 'function'; readonly expression: string };

const literalKindSchema = type("'literal'");
const functionKindSchema = type("'function'");
const ControlPolicySchema = type("'managed' | 'tolerated' | 'external' | 'observed'");

export const ColumnDefaultLiteralSchema = type.declare<ColumnDefaultLiteral>().type({
  kind: literalKindSchema,
  value: 'string | number | boolean | null | unknown[] | Record<string, unknown>',
});

export const ColumnDefaultFunctionSchema = type.declare<ColumnDefaultFunction>().type({
  kind: functionKindSchema,
  expression: 'string',
});

export const ColumnDefaultSchema = ColumnDefaultLiteralSchema.or(ColumnDefaultFunctionSchema);

const StorageValueSetRefSchema = type({
  plane: "'storage'",
  namespaceId: 'string',
  entityKind: "'valueSet'",
  entityName: 'string',
  'spaceId?': 'string',
});

const StorageColumnSchema = type({
  '+': 'reject',
  nativeType: 'string',
  codecId: 'string',
  nullable: 'boolean',
  'many?': type('false').or({ elementNullable: 'boolean' }),
  'typeParams?': 'Record<string, unknown>',
  'typeRef?': 'string',
  'default?': ColumnDefaultSchema,
  'control?': ControlPolicySchema,
  'valueSet?': StorageValueSetRefSchema,
  // Arktype schema expression, so the union stays a string literal here; the
  // canonical spelling is `CheckKind` in `@internal/sql-schema-ir/naming`.
  'noCheck?': '("membership" | "elementNotNull")[]',
}).narrow((col, ctx) => {
  if (col.typeParams !== undefined && col.typeRef !== undefined) {
    return ctx.mustBe('a column with either typeParams or typeRef, not both');
  }

  if (col.noCheck !== undefined) {
    if (col.noCheck.length === 0) {
      return ctx.mustBe('a column whose noCheck array is non-empty (omit the key when enforced)');
    }
    for (let i = 1; i < col.noCheck.length; i += 1) {
      const previous = col.noCheck[i - 1];
      const current = col.noCheck[i];
      if (previous !== undefined && current !== undefined && previous >= current) {
        return ctx.mustBe(
          'a column whose noCheck kinds are unique and sorted ascending lexicographically',
        );
      }
    }
  }
  return true;
});

/**
 * Storage value-set entry under `storage.namespaces[id].entries.valueSet[name]`.
 * Carries a `kind: 'valueSet'` discriminator (enumerable, survives JSON) and an
 * ordered `values` array of codec-encoded permitted values.
 */
export const StorageValueSetSchema = type({
  kind: "'valueSet'",
  values: type('string | number | boolean | null | unknown[] | Record<string, unknown>')
    .array()
    .readonly(),
});

const PrimaryKeySchema = type.declare<PrimaryKeyInput>().type({
  columns: type.string.array().readonly(),
  'name?': 'string',
});

const UniqueConstraintSchema = type.declare<UniqueConstraintInput>().type({
  columns: type.string.array().readonly(),
  'name?': 'string',
});

export const IndexSchema = type({
  name: 'string',
  'prefix?': 'string',
  'columns?': type.string.array().readonly(),
  'expression?': 'string',
  'where?': 'string',
  unique: 'boolean',
  'type?': 'string',
  'options?': 'Record<string, unknown>',
});

export const ForeignKeyReferenceSchema = type({
  '+': 'reject',
  namespaceId: 'string',
  tableName: 'string',
  columns: type.string.array().readonly(),
  'spaceId?': 'string',
}) satisfies Type<ForeignKeyReferenceInput>;

export const ForeignKeySourceSchema = type({
  '+': 'reject',
  namespaceId: 'string',
  tableName: 'string',
  columns: type.string.array().readonly(),
}) satisfies Type<ForeignKeyReferenceInput>;

export const ReferentialActionSchema = type
  .declare<ReferentialAction>()
  .type("'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault'");

export const ForeignKeySchema = type.declare<ForeignKeyInput>().type({
  source: ForeignKeySourceSchema,
  target: ForeignKeyReferenceSchema,
  'name?': 'string',
  'onDelete?': ReferentialActionSchema,
  'onUpdate?': ReferentialActionSchema,
});

export const CheckConstraintSchema = type({
  '+': 'reject',
  name: 'string',
  'prefix?': 'string',
  expression: 'string',
});

export const StorageTableSchema = type({
  '+': 'reject',
  columns: type({ '[string]': StorageColumnSchema }),
  'primaryKey?': PrimaryKeySchema,
  uniques: UniqueConstraintSchema.array().readonly(),
  indexes: IndexSchema.array().readonly(),
  foreignKeys: ForeignKeySchema.array().readonly(),
  'control?': ControlPolicySchema,
  'checks?': CheckConstraintSchema.array().readonly(),
});
