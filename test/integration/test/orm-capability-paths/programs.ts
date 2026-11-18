import type { ScalarType } from './scalar-types';

export interface FieldShape {
  readonly name: string;
  readonly type: ScalarType;
  readonly nullable: boolean;
}

export type RelationKind = 'n:1' | '1:n' | '1:1 holder' | '1:1 other' | 'n:m';

export interface RelationShape {
  readonly name: string;
  readonly kind: RelationKind;
  readonly to: string;
  readonly many: boolean;
  readonly inverse: string | undefined;
  readonly foreignKey: readonly string[] | undefined;
  readonly required: boolean;
}

export type KeyKind = 'single' | 'generated' | 'composite';

export interface VariantShape {
  readonly value: string;
  readonly fields: readonly FieldShape[];
  readonly ownTable: boolean;
}

export interface ModelShape {
  readonly name: string;
  readonly discriminator: string | undefined;
  readonly variants: readonly VariantShape[];
  readonly fields: readonly FieldShape[];
  readonly key: readonly string[];
  readonly keyKind: KeyKind;
  readonly uniques: readonly (readonly string[])[];
  readonly relations: readonly RelationShape[];
}

export interface SchemaShape {
  readonly models: readonly ModelShape[];
}

export function modelOf(schema: SchemaShape, name: string): ModelShape {
  const model = schema.models.find((candidate) => candidate.name === name);
  if (model === undefined) throw new Error(`the schema has no model ${name}`);
  return model;
}

export function variantOf(model: ModelShape, value: string): VariantShape {
  const variant = model.variants.find((candidate) => candidate.value === value);
  if (variant === undefined) throw new Error(`${model.name} has no variant ${value}`);
  return variant;
}

export function scoped(model: ModelShape, variant: string | undefined): ModelShape {
  const own = model.fields.filter((field) => field.name !== model.discriminator);
  const added = variant === undefined ? [] : variantOf(model, variant).fields;
  return { ...model, fields: [...own, ...added] };
}

export function relationOf(model: ModelShape, name: string): RelationShape {
  const relation = model.relations.find((candidate) => candidate.name === name);
  if (relation === undefined) throw new Error(`${model.name} has no relation ${name}`);
  return relation;
}

export function fieldOf(model: ModelShape, name: string): FieldShape {
  const field = model.fields.find((candidate) => candidate.name === name);
  if (field === undefined) throw new Error(`${model.name} has no field ${name}`);
  return field;
}

export type Scalars = Readonly<Record<string, unknown>>;
export type Key = Readonly<Record<string, unknown>>;

export interface NewRow {
  readonly scalars: Scalars;
  readonly related: Readonly<Record<string, NewRelated>>;
}

interface OfVariant {
  readonly variant: string | undefined;
}

export type NewRelated =
  | (OfVariant & { readonly kind: 'create'; readonly rows: readonly NewRow[] })
  | (OfVariant & { readonly kind: 'connect'; readonly keys: readonly Key[] });

export type Quantifier = 'some' | 'none' | 'every';

export type Filter =
  | { readonly kind: 'equals'; readonly field: string; readonly value: unknown }
  | { readonly kind: 'isNull'; readonly field: string }
  | { readonly kind: 'in'; readonly field: string; readonly values: readonly unknown[] }
  | {
      readonly kind: 'related';
      readonly relation: string;
      readonly quantifier: Quantifier;
      readonly filter: Filter | undefined;
    };

export type RelatedChange =
  | NewRelated
  | (OfVariant & { readonly kind: 'disconnect'; readonly keys: readonly Key[] | undefined })
  | (OfVariant & {
      readonly kind: 'updateAll';
      readonly filter: Filter | undefined;
      readonly changes: Scalars;
    })
  | (OfVariant & { readonly kind: 'deleteAll'; readonly filter: Filter | undefined });

export interface Included {
  readonly filter: Filter | undefined;
  readonly limit: number | undefined;
  readonly include: IncludeTree;
}

export type IncludeTree = Readonly<Record<string, Included>>;

export interface Shape {
  readonly select: readonly string[] | undefined;
  readonly include: IncludeTree;
}

interface OnModel extends OfVariant {
  readonly model: string;
  readonly shape: Shape;
}

export type Command =
  | (OnModel & { readonly kind: 'create'; readonly row: NewRow })
  | (OnModel & {
      readonly kind: 'createAll';
      readonly rows: readonly Scalars[];
      readonly counted: boolean;
    })
  | (OnModel & {
      readonly kind: 'update';
      readonly key: Key;
      readonly also: Filter | undefined;
      readonly changes: Scalars;
      readonly related: Readonly<Record<string, readonly RelatedChange[]>>;
    })
  | (OnModel & {
      readonly kind: 'updateAll';
      readonly filter: Filter;
      readonly changes: Scalars;
      readonly counted: boolean;
    })
  | (OnModel & { readonly kind: 'delete'; readonly key: Key; readonly also: Filter | undefined })
  | (OnModel & { readonly kind: 'deleteAll'; readonly filter: Filter; readonly counted: boolean })
  | (OnModel & {
      readonly kind: 'upsert';
      readonly create: Scalars;
      readonly update: Scalars;
      readonly conflictOn: readonly string[];
    })
  | (OnModel & {
      readonly kind: 'read';
      readonly filter: Filter | undefined;
      readonly limit: number | undefined;
    });

export function depthOfRow(row: NewRow): number {
  const below = Object.values(row.related).flatMap((related) =>
    related.kind === 'create' ? related.rows.map(depthOfRow) : [],
  );
  return 1 + Math.max(0, ...below);
}

export function depthOfInclude(include: IncludeTree): number {
  const below = Object.values(include).map((included) => depthOfInclude(included.include));
  return below.length === 0 ? 0 : 1 + Math.max(...below);
}

export interface Sequence {
  readonly existing: readonly Command[];
  readonly following: readonly Command[];
}
