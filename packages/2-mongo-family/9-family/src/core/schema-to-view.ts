import type { CoreSchemaView } from '@internal/framework-components/control';
import { SchemaTreeNode } from '@internal/framework-components/control';
import { validatorRootShapesOf } from '@internal/mongo-contract';
import type { MongoSchemaCollection, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { ifDefined } from '@internal/utils/defined';

export function mongoSchemaToView(schema: MongoSchemaIR): CoreSchemaView {
  const collectionNodes = schema.collections.map((collection) =>
    collectionToSchemaNode(collection.name, collection),
  );

  return {
    root: new SchemaTreeNode({
      kind: 'root',
      id: 'mongo-schema',
      labelParts: [{ text: 'database', role: 'title' }],
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

    children.push(
      new SchemaTreeNode({
        kind: 'index',
        id: `index-${name}-${index.name}`,
        labelParts: [
          { text: prefix, role: 'keyword' },
          { text: ' (' },
          { text: keysSummary, role: 'name' },
          { text: ')' },
          ...(options.length > 0
            ? [{ text: ' ' }, { text: `(${options.join(', ')})`, role: 'detail' as const }]
            : []),
        ],
        meta: {
          name: index.name,
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
    const roots = validatorRootShapesOf(collection.validator.jsonSchema);
    const fields = new Map<string, Set<string>>();
    for (const root of roots) {
      for (const [propName, propDef] of Object.entries(root.properties)) {
        const types = fields.get(propName) ?? new Set<string>();
        for (const type of bsonTypesOf(propDef)) types.add(type);
        fields.set(propName, types);
      }
    }

    for (const [propName, types] of fields) {
      const bsonType = types.has('any') ? 'any' : [...types].join(',');
      const required = roots.every(
        (root) => !Object.hasOwn(root.properties, propName) || root.required.includes(propName),
      );
      validatorChildren.push(
        new SchemaTreeNode({
          kind: 'field',
          id: `field-${name}-${propName}`,
          labelParts: [
            { text: propName, role: 'name' },
            { text: ': ' },
            { text: bsonType },
            ...(required ? [{ text: ' ' }, { text: '(required)', role: 'detail' as const }] : []),
          ],
        }),
      );
    }

    children.push(
      new SchemaTreeNode({
        kind: 'field',
        id: `validator-${name}`,
        labelParts: [
          { text: 'validator', role: 'keyword' },
          { text: ' ' },
          {
            text: `(level: ${collection.validator.validationLevel}, action: ${collection.validator.validationAction})`,
            role: 'detail',
          },
        ],
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
          labelParts: [
            { text: 'options', role: 'keyword' },
            { text: ' ' },
            { text: `(${optLabels.join(', ')})`, role: 'detail' },
          ],
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
    labelParts: [
      { text: 'collection', role: 'keyword' },
      { text: ' ' },
      { text: name, role: 'name' },
    ],
    ...ifDefined('children', children.length > 0 ? children : undefined),
  });
}

function bsonTypesOf(propDef: unknown): readonly string[] {
  if (typeof propDef !== 'object' || propDef === null || !('bsonType' in propDef)) return ['any'];
  const { bsonType } = propDef;
  return Array.isArray(bsonType) ? bsonType.map(String) : [String(bsonType)];
}
