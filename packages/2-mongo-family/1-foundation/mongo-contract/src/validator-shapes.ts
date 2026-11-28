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
 * another validator of the collection: its `root`, and the variant's discriminator value, or its
 * position when it has none. `sameKindOfDocumentIn` also matches a variant with a shape whose key
 * differs; see there.
 */
export interface ValidatorDocumentShape {
  readonly key: string;
  /**
   * The root's position in `anyOf` and the number of roots. A validator names no root model, so
   * position is the root's only identity. `deriveCollectionValidators` writes roots in name order, and
   * a root model added or removed moves the others, so roots of validators with different numbers of
   * roots never match.
   */
  readonly root: string;
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
  const roots = validatorRootShapesOf(jsonSchema);
  return roots.flatMap((root, rootIndex): ValidatorDocumentShape[] => {
    const rootKey = `${rootIndex}/${roots.length}`;
    if (root.variants.length === 0) {
      return [
        {
          key: rootKey,
          root: rootKey,
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
        key: `${rootKey}:${discriminator === undefined ? variantIndex : JSON.stringify([discriminator.field, discriminator.value])}`,
        root: rootKey,
        rootIndex,
        discriminator,
        required: [...new Set([...root.required, ...variant.required])],
        properties: { ...root.properties, ...variant.properties },
        closed: root.closed || variant.closed,
      };
    });
  });
}

/** A shape of another validator of the collection that describes the same kind of document, and which rule of `sameKindOfDocumentIn` found it. */
export interface SameKindOfDocument {
  readonly shape: ValidatorDocumentShape;
  readonly matchedBy: 'key' | 'root' | 'discriminatorValue' | (string & {});
}

/**
 * The shape among `shapes`, from another validator of the collection, that describes the same kind
 * of document as `shape`: the one with the same key; for a variant, otherwise the root it comes
 * from when that root had no variants, or the variant of that root with the same discriminator
 * value when the discriminator field changes.
 */
export function sameKindOfDocumentIn(
  shapes: readonly ValidatorDocumentShape[],
  shape: ValidatorDocumentShape,
): SameKindOfDocument | undefined {
  const matched = (
    found: ValidatorDocumentShape | undefined,
    matchedBy: SameKindOfDocument['matchedBy'],
  ) => (found === undefined ? undefined : { shape: found, matchedBy });
  const sameKey = matched(
    shapes.find(({ key }) => key === shape.key),
    'key',
  );
  if (sameKey !== undefined || shape.discriminator === undefined) return sameKey;
  const value = JSON.stringify(shape.discriminator.value);
  return (
    matched(
      shapes.find(({ key }) => key === shape.root),
      'root',
    ) ??
    matched(
      shapes.find(
        ({ root, discriminator }) =>
          root === shape.root &&
          discriminator !== undefined &&
          JSON.stringify(discriminator.value) === value,
      ),
      'discriminatorValue',
    )
  );
}

const NUMBER_TYPES = ['int', 'long', 'double', 'decimal'];

/**
 * The BSON types a property schema's `bsonType` names, `number` read as every numeric type; none
 * when it names none.
 */
export function propertyBsonTypesOf(schema: unknown): readonly string[] {
  const bsonType = isRecord(schema) ? schema['bsonType'] : undefined;
  const names = Array.isArray(bsonType) ? bsonType : bsonType === undefined ? [] : [bsonType];
  return names
    .filter((name): name is string => typeof name === 'string')
    .flatMap((name) => (name === 'number' ? NUMBER_TYPES : [name]));
}
