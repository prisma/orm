/** One object shape a collection validator describes: a root model's fields, or a variant's. */
export interface ValidatorShape {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
  /** Whether the shape allows no field but its properties (`additionalProperties: false`). */
  readonly closed: boolean;
}

/** A root model's shape in a collection validator, with one shape per variant. */
export interface ValidatorRootShape extends ValidatorShape {
  readonly variants: readonly ValidatorShape[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function records(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function shapeOf(schema: Record<string, unknown>): ValidatorShape {
  const properties = schema['properties'];
  const required = schema['required'];
  return {
    properties: isRecord(properties) ? properties : {},
    required: Array.isArray(required)
      ? required.filter((name): name is string => typeof name === 'string')
      : [],
    closed: schema['additionalProperties'] === false,
  };
}

/**
 * The root model shapes a collection validator's `$jsonSchema` describes, as `deriveCollectionValidators` writes it: one per `anyOf` branch when the collection stores several root models, otherwise the schema itself, each with its variants' `oneOf` branches.
 */
export function validatorRootShapesOf(jsonSchema: unknown): readonly ValidatorRootShape[] {
  if (!isRecord(jsonSchema)) return [];
  const roots = Array.isArray(jsonSchema['anyOf']) ? records(jsonSchema['anyOf']) : [jsonSchema];
  return roots.map((root) => ({
    ...shapeOf(root),
    variants: records(root['oneOf']).map(shapeOf),
  }));
}

/** Every field name a collection validator declares, for a root model or for a variant. */
export function validatorFieldNamesOf(jsonSchema: unknown): ReadonlySet<string> {
  return new Set(
    validatorRootShapesOf(jsonSchema).flatMap((root) => [
      ...Object.keys(root.properties),
      ...root.variants.flatMap((variant) => Object.keys(variant.properties)),
    ]),
  );
}

/**
 * The discriminator a variant branch selects on: its one property whose schema is only
 * `{ enum: [value] }`, as the derived validator writes it. A field typed by a one-value enum also has
 * a `bsonType`.
 */
export interface ValidatorDiscriminator {
  readonly field: string;
  readonly value: unknown;
}

/**
 * One kind of document a collection validator describes: a root model with no variants, or a
 * variant with its root's required fields and properties. `key` names the same kind of document in
 * another validator of the collection: the root's position in `anyOf`, and the variant's
 * discriminator value, or its position when it has none. Roots are matched by position because
 * `deriveCollectionValidators` writes them in the same order every time.
 */
export interface ValidatorDocumentShape {
  readonly key: string;
  readonly rootIndex: number;
  readonly discriminator: ValidatorDiscriminator | undefined;
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
  readonly closed: boolean;
}

function discriminatorOf(
  properties: Readonly<Record<string, unknown>>,
): ValidatorDiscriminator | undefined {
  const named = Object.entries(properties).flatMap(([field, schema]) => {
    if (!isRecord(schema) || Object.keys(schema).length !== 1) return [];
    const values = schema['enum'];
    return Array.isArray(values) && values.length === 1 ? [{ field, value: values[0] }] : [];
  });
  const [only, ...others] = named;
  return others.length === 0 ? only : undefined;
}

/** Each kind of document a collection validator's `$jsonSchema` describes. */
export function validatorDocumentShapesOf(jsonSchema: unknown): readonly ValidatorDocumentShape[] {
  return validatorRootShapesOf(jsonSchema).flatMap((root, rootIndex): ValidatorDocumentShape[] => {
    if (root.variants.length === 0) {
      return [
        {
          key: `${rootIndex}`,
          rootIndex,
          discriminator: undefined,
          required: root.required,
          properties: root.properties,
          closed: root.closed,
        },
      ];
    }
    return root.variants.map((variant, variantIndex) => {
      const discriminator = discriminatorOf(variant.properties);
      return {
        key: `${rootIndex}:${discriminator === undefined ? variantIndex : JSON.stringify([discriminator.field, discriminator.value])}`,
        rootIndex,
        discriminator,
        required: [...new Set([...root.required, ...variant.required])],
        properties: { ...root.properties, ...variant.properties },
        closed: root.closed || variant.closed,
      };
    });
  });
}
