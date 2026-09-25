import type { CoreSchemaView } from '@internal/framework-components/control';
import { SchemaTreeNode } from '@internal/framework-components/control';
import type { MongoSchemaCollection, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';

export function mongoSchemaToView(schema: MongoSchemaIR): CoreSchemaView {
  const collectionNodes = schema.collections.map((collection) =>
    collectionToSchemaNode(collection.name, collection),
  );

  return {
    root: new SchemaTreeNode({
      kind: 'root',
      id: 'mongo-schema',
      label: 'database',
      ...ifDefined('children', collectionNodes.length > 0 ? collectionNodes : undefined),
    }),
  };
}

function collectionToSchemaNode(name: string, collection: MongoSchemaCollection): SchemaTreeNode {
  const children: SchemaTreeNode[] = [];

  for (const index of collection.indexes) {
    const keysSummary = index.keys
      .map((k) => {
        if (k.direction === 1) return k.field;
        if (k.direction === -1) return `${k.field} desc`;
        return `${k.field} ${k.direction}`;
      })
      .join(', ');
    const prefix = index.unique ? 'unique index' : 'index';
    const options: string[] = [];
    if (index.sparse) options.push('sparse');
    if (index.expireAfterSeconds != null) options.push(`ttl: ${index.expireAfterSeconds}s`);
    if (index.partialFilterExpression) options.push('partial');
    const optsSuffix = options.length > 0 ? ` (${options.join(', ')})` : '';

    children.push(
      new SchemaTreeNode({
        kind: 'index',
        id: `index-${name}-${index.keys.map((k) => `${k.field}_${k.direction}`).join('_')}`,
        label: `${prefix} (${keysSummary})${optsSuffix}`,
        meta: {
          keys: index.keys,
          unique: index.unique,
          ...ifDefined('sparse', index.sparse || undefined),
          ...ifDefined('expireAfterSeconds', index.expireAfterSeconds ?? undefined),
          ...ifDefined('partialFilterExpression', index.partialFilterExpression ?? undefined),
        },
      }),
    );
  }

  if (collection.validator) {
    const validatorChildren: SchemaTreeNode[] = [];
    const jsonSchema = blindCast<
      {
        readonly properties?: Readonly<Record<string, { readonly bsonType?: unknown }>>;
        readonly required?: readonly string[];
      },
      'a collection validator is a $jsonSchema object'
    >(collection.validator.jsonSchema);
    const properties = jsonSchema.properties;
    const required = new Set(jsonSchema.required ?? []);

    if (properties) {
      for (const [propName, propDef] of Object.entries(properties)) {
        const bsonType = propDef.bsonType === undefined ? 'any' : String(propDef.bsonType);
        const suffix = required.has(propName) ? ' (required)' : '';
        validatorChildren.push(
          new SchemaTreeNode({
            kind: 'field',
            id: `field-${name}-${propName}`,
            label: `${propName}: ${bsonType}${suffix}`,
          }),
        );
      }
    }

    children.push(
      new SchemaTreeNode({
        kind: 'field',
        id: `validator-${name}`,
        label: `validator (level: ${collection.validator.validationLevel}, action: ${collection.validator.validationAction})`,
        meta: {
          validationLevel: collection.validator.validationLevel,
          validationAction: collection.validator.validationAction,
          jsonSchema: collection.validator.jsonSchema,
        },
        ...ifDefined('children', validatorChildren.length > 0 ? validatorChildren : undefined),
      }),
    );
  }

  if (collection.options) {
    const opts = collection.options;
    const optLabels: string[] = [];
    if (opts.capped) optLabels.push('capped');
    if (opts.timeseries) optLabels.push('timeseries');
    if (opts.collation) optLabels.push('collation');
    if (opts.changeStreamPreAndPostImages) optLabels.push('changeStreamPreAndPostImages');
    if (opts.clusteredIndex) optLabels.push('clusteredIndex');

    if (optLabels.length > 0) {
      children.push(
        new SchemaTreeNode({
          kind: 'field',
          id: `options-${name}`,
          label: `options (${optLabels.join(', ')})`,
          meta: {
            ...ifDefined('capped', opts.capped ?? undefined),
            ...ifDefined('timeseries', opts.timeseries ?? undefined),
            ...ifDefined('collation', opts.collation ?? undefined),
            ...ifDefined(
              'changeStreamPreAndPostImages',
              opts.changeStreamPreAndPostImages ?? undefined,
            ),
            ...ifDefined('clusteredIndex', opts.clusteredIndex ?? undefined),
          },
        }),
      );
    }
  }

  return new SchemaTreeNode({
    kind: 'collection',
    id: `collection-${name}`,
    label: `collection ${name}`,
    ...ifDefined('children', children.length > 0 ? children : undefined),
  });
}
