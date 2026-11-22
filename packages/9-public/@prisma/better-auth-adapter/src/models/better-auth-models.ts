import type { BetterAuthOptions } from '@better-auth/core';
import type { BetterAuthDBSchema, DBFieldAttribute } from '@better-auth/core/db';

export type ReferentialAction = NonNullable<
  NonNullable<DBFieldAttribute['references']>['onDelete']
>;

export interface BetterAuthReference {
  readonly model: string;
  readonly field: string;
  readonly onDelete: ReferentialAction;
}

export interface BetterAuthField {
  readonly name: string;
  readonly attribute: DBFieldAttribute;
  readonly reference: BetterAuthReference | undefined;
}

export interface BetterAuthIndex {
  readonly fields: readonly string[];
  readonly unique: boolean;
}

/** A model Better Auth calls, after `usePlural` and with tables that share a physical name merged. Its fields do not include `id`. */
export interface BetterAuthModel {
  /** Better Auth's name for the model after `modelName` and `usePlural`. It is matched to a contract model name, never to a table name. */
  readonly physicalName: string;
  readonly fields: readonly BetterAuthField[];
  readonly indexes: readonly BetterAuthIndex[];
  /** Whether the model is part of the schema Better Auth manages: false when every table merged into it is marked `disableMigrations`, or is the session table while sessions live in secondary storage. */
  readonly managed: boolean;
}

export interface BetterAuthModelsOptions {
  readonly betterAuthOptions: BetterAuthOptions;
  readonly usePlural: boolean;
}

type Table = BetterAuthDBSchema[string];

interface MergedModel {
  readonly fields: Map<string, BetterAuthField>;
  readonly indexes: BetterAuthIndex[];
  managed: boolean;
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
): BetterAuthReference {
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
  { betterAuthOptions, usePlural }: BetterAuthModelsOptions,
): BetterAuthModel[] {
  const merged = new Map<string, MergedModel>();
  for (const [key, table] of Object.entries(tables)) {
    const name = physicalName(table.modelName, usePlural);
    const model: MergedModel = merged.get(name) ?? {
      fields: new Map(),
      indexes: [],
      managed: false,
    };
    model.managed ||= !isOmitted(key, table, betterAuthOptions);
    merged.set(name, model);
    for (const [fieldKey, attribute] of Object.entries(table.fields)) {
      const fieldName = attribute.fieldName || fieldKey;
      if (fieldName === 'id') continue;
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
  return [...merged].map(([name, { fields, indexes, managed }]) => ({
    physicalName: name,
    fields: [...fields.values()],
    indexes,
    managed,
  }));
}

/** The models of the schema Better Auth manages, which the comparison checks. */
export function managedModels(
  tables: BetterAuthDBSchema,
  options: BetterAuthModelsOptions,
): BetterAuthModel[] {
  return betterAuthModels(tables, options).filter((model) => model.managed);
}
