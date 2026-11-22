import type { BetterAuthOptions } from '@better-auth/core';
import type { BetterAuthDBSchema, DBFieldAttribute } from '@better-auth/core/db';
import { assertFieldName } from './identifiers';

export type ReferentialAction = NonNullable<
  NonNullable<DBFieldAttribute['references']>['onDelete']
>;

export interface ExpectedReference {
  readonly model: string;
  readonly field: string;
  readonly onDelete: ReferentialAction;
}

export interface ExpectedField {
  readonly name: string;
  readonly attribute: DBFieldAttribute;
  readonly reference: ExpectedReference | undefined;
}

export interface ExpectedIndex {
  readonly fields: readonly string[];
  readonly unique: boolean;
}

/** A model Better Auth calls, after `usePlural` and with tables that share a physical name merged. Its fields do not include `id`. */
export interface ExpectedModel {
  readonly physicalName: string;
  readonly fields: readonly ExpectedField[];
  readonly indexes: readonly ExpectedIndex[];
  /** False when every table merged into it is left out of schema work: `disableMigrations`, or sessions kept in secondary storage. */
  readonly checked: boolean;
}

export interface ExpectedModelsOptions {
  readonly betterAuthOptions: BetterAuthOptions;
  readonly usePlural: boolean;
}

type Table = BetterAuthDBSchema[string];

interface MergedModel {
  readonly fields: Map<string, ExpectedField>;
  readonly indexes: ExpectedIndex[];
  checked: boolean;
}

function physicalName(modelName: string, usePlural: boolean): string {
  return usePlural ? `${modelName}s` : modelName;
}

function isOmitted(key: string, table: Table, options: BetterAuthOptions): boolean {
  if (table.disableMigrations === true) return true;
  return (
    key === 'session' &&
    options.secondaryStorage !== undefined &&
    options.session?.storeSessionInDatabase !== true
  );
}

function referencedTable(tables: BetterAuthDBSchema, model: string): Table | undefined {
  return tables[model] ?? Object.values(tables).find((table) => table.modelName === model);
}

function resolveReference(
  tables: BetterAuthDBSchema,
  references: NonNullable<DBFieldAttribute['references']>,
  usePlural: boolean,
): ExpectedReference {
  const table = referencedTable(tables, references.model);
  const field = table?.fields[references.field];
  return {
    model: physicalName(table?.modelName ?? references.model, usePlural),
    field: field?.fieldName || references.field,
    onDelete: references.onDelete ?? 'cascade',
  };
}

/**
 * The models Better Auth's table description names, one per physical model name, in Better Auth's table order. The adapter serves calls for all of them.
 */
export function betterAuthModels(
  tables: BetterAuthDBSchema,
  { betterAuthOptions, usePlural }: ExpectedModelsOptions,
): ExpectedModel[] {
  const merged = new Map<string, MergedModel>();
  for (const [key, table] of Object.entries(tables)) {
    const name = physicalName(table.modelName, usePlural);
    const model: MergedModel = merged.get(name) ?? {
      fields: new Map(),
      indexes: [],
      checked: false,
    };
    model.checked ||= !isOmitted(key, table, betterAuthOptions);
    merged.set(name, model);
    for (const [fieldKey, attribute] of Object.entries(table.fields)) {
      const fieldName = attribute.fieldName || fieldKey;
      if (fieldName === 'id') continue;
      assertFieldName(name, fieldName);
      model.fields.set(fieldName, {
        name: fieldName,
        attribute,
        reference:
          attribute.references === undefined
            ? undefined
            : resolveReference(tables, attribute.references, usePlural),
      });
    }
    for (const index of table.indexes ?? []) {
      model.indexes.push({
        fields: index.fields.map((field) => table.fields[field]?.fieldName || field),
        unique: index.unique === true,
      });
    }
  }
  return [...merged].map(([name, { fields, indexes, checked }]) => ({
    physicalName: name,
    fields: [...fields.values()],
    indexes,
    checked,
  }));
}

/** The models the comparison checks: those `betterAuthModels` marks as checked. */
export function checkedModels(
  tables: BetterAuthDBSchema,
  options: ExpectedModelsOptions,
): ExpectedModel[] {
  return betterAuthModels(tables, options).filter((model) => model.checked);
}
