/**
 * Mongo migration IR: one concrete `*Call` class per pure factory under
 * `migration-factories.ts`, plus a shared `OpFactoryCallNode` abstract
 * base. Every call class carries the literal arguments its backing
 * factory would receive, computes a human-readable `label` in its
 * constructor, and implements two polymorphic hooks:
 *
 * - `toOp()` — converts the IR node to a runtime
 *   `MongoMigrationPlanOperation` by delegating to the matching pure
 *   factory in `migration-factories.ts`.
 * - `renderTypeScript()` / `importRequirements()` — inherited from
 *   `TsExpression`. Used by `renderCallsToTypeScript` to emit the call
 *   as a TypeScript expression inside the scaffolded `migration.ts`.
 *
 * The abstract base and all concrete classes are package-private.
 * External consumers see only the framework-level `OpFactoryCall`
 * interface and the `OpFactoryCall` union.
 */

import type {
  OpFactoryCall as FrameworkOpFactoryCall,
  MigrationOperationClass,
} from '@internal/framework-components/control';
import type {
  AnyMongoMigrationOperation,
  CollModOptions,
  CreateCollectionOptions,
  CreateIndexOptions,
  MongoIndexKey,
  MongoMigrationPlanOperation,
} from '@internal/mongo-query-ast/control';
import type {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import type { Document } from '@internal/mongo-value';
import { type ImportRequirement, jsonToTsSource, TsExpression } from '@internal/ts-render';
import { ifDefined } from '@internal/utils/defined';
import {
  collMod,
  createCollection,
  createIndex,
  dropCollection,
  dropIndex,
  renameCollection,
  renameField,
  unsetField,
} from './migration-factories';

export interface CollModMeta {
  readonly id?: string;
  readonly label?: string;
  readonly operationClass?: MigrationOperationClass;
}

/**
 * The single module a scaffolded Mongo `migration.ts` imports from: the
 * operation factories below, plus the `Migration` base and `MigrationCLI`
 * that `render-typescript.ts` adds. The authored name; `render-typescript.ts`
 * maps it to whatever the consuming application's import root calls it,
 * once over the whole assembled import list.
 */
export const TARGET_MIGRATION_MODULE = '@internal/target-mongo/migration';

abstract class OpFactoryCallNode extends TsExpression implements FrameworkOpFactoryCall {
  abstract readonly factoryName: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract toOp(): AnyMongoMigrationOperation;

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: TARGET_MIGRATION_MODULE, symbol: this.factoryName }];
  }

  protected freeze(): void {
    Object.freeze(this);
  }
}

function formatKeys(keys: ReadonlyArray<MongoIndexKey>): string {
  return keys.map((k) => `${k.field}:${k.direction}`).join(', ');
}

/** The index a call creates or drops: its name and options as `createIndex` takes them. */
export type IndexCallOptions = CreateIndexOptions & { readonly name: string };

export class CreateIndexCall extends OpFactoryCallNode {
  readonly factoryName = 'createIndex' as const;
  readonly operationClass = 'additive' as const;
  readonly collection: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly options: IndexCallOptions;
  readonly label: string;

  constructor(collection: string, keys: ReadonlyArray<MongoIndexKey>, options: IndexCallOptions) {
    super();
    this.collection = collection;
    this.keys = keys;
    this.options = options;
    this.label = `Create index ${options.name} on ${collection} (${formatKeys(keys)})`;
    this.freeze();
  }

  toOp(): MongoMigrationPlanOperation {
    return createIndex(this.collection, this.keys, this.options);
  }

  renderTypeScript(): string {
    return `createIndex(${jsonToTsSource(this.collection)}, ${jsonToTsSource(this.keys)}, ${jsonToTsSource(this.options)})`;
  }
}

export class DropIndexCall extends OpFactoryCallNode {
  readonly factoryName = 'dropIndex' as const;
  readonly operationClass = 'widening' as const;
  readonly collection: string;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly options: IndexCallOptions;
  readonly label: string;

  constructor(collection: string, keys: ReadonlyArray<MongoIndexKey>, options: IndexCallOptions) {
    super();
    this.collection = collection;
    this.keys = keys;
    this.options = options;
    this.label = `Drop index ${options.name} on ${collection} (${formatKeys(keys)})`;
    this.freeze();
  }

  toOp(): MongoMigrationPlanOperation {
    return dropIndex(this.collection, this.keys, this.options);
  }

  renderTypeScript(): string {
    return `dropIndex(${jsonToTsSource(this.collection)}, ${jsonToTsSource(this.keys)}, ${jsonToTsSource(this.options)})`;
  }
}

export class CreateCollectionCall extends OpFactoryCallNode {
  readonly factoryName = 'createCollection' as const;
  readonly operationClass = 'additive' as const;
  readonly collection: string;
  readonly options: CreateCollectionOptions | undefined;
  readonly label: string;

  constructor(collection: string, options?: CreateCollectionOptions) {
    super();
    this.collection = collection;
    this.options = options;
    this.label = `Create collection ${collection}`;
    this.freeze();
  }

  toOp(): MongoMigrationPlanOperation {
    return createCollection(this.collection, this.options);
  }

  renderTypeScript(): string {
    return this.options
      ? `createCollection(${jsonToTsSource(this.collection)}, ${jsonToTsSource(this.options)})`
      : `createCollection(${jsonToTsSource(this.collection)})`;
  }
}

export class DropCollectionCall extends OpFactoryCallNode {
  readonly factoryName = 'dropCollection' as const;
  readonly operationClass = 'destructive' as const;
  readonly collection: string;
  readonly label: string;

  constructor(collection: string) {
    super();
    this.collection = collection;
    this.label = `Drop collection ${collection}`;
    this.freeze();
  }

  toOp(): MongoMigrationPlanOperation {
    return dropCollection(this.collection);
  }

  renderTypeScript(): string {
    return `dropCollection(${jsonToTsSource(this.collection)})`;
  }
}

export class RenameCollectionCall extends OpFactoryCallNode {
  readonly factoryName = 'renameCollection' as const;
  readonly operationClass = 'widening' as const;
  readonly from: string;
  readonly to: string;
  readonly label: string;

  constructor(from: string, to: string) {
    super();
    this.from = from;
    this.to = to;
    this.label = `Rename collection ${from} to ${to}`;
    this.freeze();
  }

  toOp(): MongoMigrationPlanOperation {
    return renameCollection(this.from, this.to);
  }

  renderTypeScript(): string {
    return `renameCollection(${jsonToTsSource(this.from)}, ${jsonToTsSource(this.to)})`;
  }
}

function renderFilterOption(filter: Document | undefined): string {
  return filter === undefined ? '' : `, ${jsonToTsSource({ filter })}`;
}

export class RenameFieldCall extends OpFactoryCallNode {
  readonly factoryName = 'renameField' as const;
  readonly operationClass = 'widening' as const;
  readonly collection: string;
  readonly from: string;
  readonly to: string;
  readonly filter: Document | undefined;
  readonly label: string;

  constructor(collection: string, from: string, to: string, filter?: Document) {
    super();
    this.collection = collection;
    this.from = from;
    this.to = to;
    this.filter = filter;
    this.label = this.toOp().label;
    this.freeze();
  }

  toOp(): AnyMongoMigrationOperation {
    return renameField(this.collection, this.from, this.to, ifDefined('filter', this.filter));
  }

  renderTypeScript(): string {
    return `renameField(${jsonToTsSource(this.collection)}, ${jsonToTsSource(this.from)}, ${jsonToTsSource(this.to)}${renderFilterOption(this.filter)})`;
  }
}

export class UnsetFieldCall extends OpFactoryCallNode {
  readonly factoryName = 'unsetField' as const;
  readonly operationClass = 'destructive' as const;
  readonly collection: string;
  readonly field: string;
  readonly filter: Document | undefined;
  readonly label: string;

  constructor(collection: string, field: string, filter?: Document) {
    super();
    this.collection = collection;
    this.field = field;
    this.filter = filter;
    this.label = this.toOp().label;
    this.freeze();
  }

  toOp(): AnyMongoMigrationOperation {
    return unsetField(this.collection, this.field, ifDefined('filter', this.filter));
  }

  renderTypeScript(): string {
    return `unsetField(${jsonToTsSource(this.collection)}, ${jsonToTsSource(this.field)}${renderFilterOption(this.filter)})`;
  }
}

export class CollModCall extends OpFactoryCallNode {
  readonly factoryName = 'collMod' as const;
  readonly collection: string;
  readonly options: CollModOptions;
  readonly meta: CollModMeta | undefined;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;

  constructor(collection: string, options: CollModOptions, meta?: CollModMeta) {
    super();
    this.collection = collection;
    this.options = options;
    this.meta = meta;
    this.operationClass = meta?.operationClass ?? 'widening';
    this.label = meta?.label ?? `Modify collection ${collection}`;
    this.freeze();
  }

  toOp(): MongoMigrationPlanOperation {
    return collMod(this.collection, this.options, this.meta);
  }

  renderTypeScript(): string {
    return this.meta
      ? `collMod(${jsonToTsSource(this.collection)}, ${jsonToTsSource(this.options)}, ${jsonToTsSource(this.meta)})`
      : `collMod(${jsonToTsSource(this.collection)}, ${jsonToTsSource(this.options)})`;
  }
}

export type OpFactoryCall =
  | CreateIndexCall
  | DropIndexCall
  | CreateCollectionCall
  | DropCollectionCall
  | RenameCollectionCall
  | RenameFieldCall
  | UnsetFieldCall
  | CollModCall;

export function schemaIndexToCreateIndexOptions(index: MongoSchemaIndex): IndexCallOptions {
  return {
    name: index.name,
    ...(index.unique ? { unique: true } : {}),
    ...ifDefined('sparse', index.sparse),
    ...ifDefined('expireAfterSeconds', index.expireAfterSeconds),
    ...ifDefined('partialFilterExpression', index.partialFilterExpression),
    ...ifDefined('wildcardProjection', index.wildcardProjection),
    ...ifDefined('collation', index.collation),
    ...ifDefined('weights', index.weights),
    ...ifDefined('default_language', index.default_language),
    ...ifDefined('language_override', index.language_override),
  };
}

export function schemaCollectionToCreateCollectionOptions(
  coll: MongoSchemaCollection,
): CreateCollectionOptions | undefined {
  const opts: MongoSchemaCollectionOptions | undefined = coll.options;
  const validator: MongoSchemaValidator | undefined = coll.validator;
  if (!opts && !validator) return undefined;
  return {
    ...(opts?.capped ? { capped: true } : {}),
    ...ifDefined('size', opts?.capped?.size),
    ...ifDefined('max', opts?.capped?.max),
    ...ifDefined('timeseries', opts?.timeseries),
    ...ifDefined('collation', opts?.collation),
    ...(opts?.clusteredIndex
      ? {
          clusteredIndex: {
            key: { _id: 1 } satisfies Record<string, number>,
            unique: true,
            ...(opts.clusteredIndex.name != null ? { name: opts.clusteredIndex.name } : {}),
          },
        }
      : {}),
    ...(validator ? { validator: { $jsonSchema: validator.jsonSchema } } : {}),
    ...ifDefined('validationLevel', validator?.validationLevel),
    ...ifDefined('validationAction', validator?.validationAction),
    ...ifDefined('changeStreamPreAndPostImages', opts?.changeStreamPreAndPostImages),
  };
}
