/** One object shape a collection validator describes: a root model's fields, or a variant's. */
export interface ValidatorShape {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
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
