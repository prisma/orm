import { ifDefined } from '@internal/utils/defined';

export type MongoResultShape =
  | { readonly kind: 'document'; readonly fields: Readonly<Record<string, MongoFieldShape>> }
  | { readonly kind: 'unknown' };

export type MongoFieldShape =
  | { readonly kind: 'leaf'; readonly codecId: string; readonly nullable: boolean }
  | {
      readonly kind: 'document';
      readonly nullable: boolean;
      readonly fields: Readonly<Record<string, MongoFieldShape>>;
      /** A stored document of the plan's collection inside a command result, such as the document an insert returns: a decode failure in it names its `_id` and gives the field's path from it. */
      readonly row?: true;
    }
  | { readonly kind: 'array'; readonly nullable: boolean; readonly element: MongoFieldShape }
  | { readonly kind: 'unknown' };

export function freezeMongoFieldShape(shape: MongoFieldShape): MongoFieldShape {
  switch (shape.kind) {
    case 'unknown':
      return Object.freeze({ kind: 'unknown' as const });
    case 'leaf':
      return Object.freeze({
        kind: 'leaf' as const,
        codecId: shape.codecId,
        nullable: shape.nullable,
      });
    case 'document': {
      const fields: Record<string, MongoFieldShape> = {};
      for (const [k, v] of Object.entries(shape.fields)) {
        fields[k] = freezeMongoFieldShape(v);
      }
      return Object.freeze({
        kind: 'document' as const,
        nullable: shape.nullable,
        fields: Object.freeze(fields),
        ...ifDefined('row', shape.row),
      });
    }
    case 'array':
      return Object.freeze({
        kind: 'array' as const,
        nullable: shape.nullable,
        element: freezeMongoFieldShape(shape.element),
      });
    default: {
      const _exhaustive: never = shape;
      return _exhaustive;
    }
  }
}

export function freezeMongoResultShape(shape: MongoResultShape): MongoResultShape {
  if (shape.kind === 'unknown') {
    return Object.freeze({ kind: 'unknown' as const });
  }
  const fields: Record<string, MongoFieldShape> = {};
  for (const [k, v] of Object.entries(shape.fields)) {
    fields[k] = freezeMongoFieldShape(v);
  }
  return Object.freeze({
    kind: 'document' as const,
    fields: Object.freeze(fields),
  });
}
