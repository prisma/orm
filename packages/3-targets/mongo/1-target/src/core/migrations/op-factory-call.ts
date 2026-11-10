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

import { CliStructuredError } from '@internal/errors/control';
import { errorUnfilledPlaceholder } from '@internal/errors/migration';
import type {
  OpFactoryCall as FrameworkOpFactoryCall,
  MigrationOperationClass,
} from '@internal/framework-components/control';
import type {
  AnyMongoMigrationOperation,
  CollModOptions,
  CreateCollectionOptions,
  CreateIndexOptions,
  MongoDmlOperation,
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
import {
  type ImportRequirement,
  jsonToTsSource,
  TsExpression,
  tsObjectSource,
} from '@internal/ts-render';
import { ifDefined } from '@internal/utils/defined';
import {
  type CastFieldOptions,
  type CheckDocumentsOptions,
  castField,
  checkDocuments,
  collMod,
  createCollection,
  createIndex,
  dropCollection,
  dropIndex,
  type FillFieldOptions,
  fillField,
  renameCollection,
  renameField,
  unsetField,
} from './migration-factories';

export interface CollModMeta {
  readonly id?: string;
  readonly label?: string;
  readonly operationClass?: MigrationOperationClass;
  /** Whether the operation first checks that every document fits the new validator, and stops if one does not. */
  readonly checkDocuments?: boolean;
}

/**
 * The single module a scaffolded Mongo `migration.ts` imports from: the
 * operation factories below, plus the `Migration` base and `MigrationCLI`
 * that `render-typescript.ts` adds. The authored name; `render-typescript.ts`
 * maps it to whatever the consuming application's import root calls it,
 * once over the whole assembled import list.
 */
export const TARGET_MIGRATION_MODULE = '@internal/target-mongo/migration';

/** For each collection whose validator `migration.ts` declares once, the name of its `const`. */
export type ValidatorNames = ReadonlyMap<string, string>;

/** The source of `value`, or the name of the `const` that holds the collection's validator. */
function validatorSource(collection: string, value: unknown, names: ValidatorNames): string {
  return names.get(collection) ?? jsonToTsSource(value);
}

abstract class OpFactoryCallNode extends TsExpression implements FrameworkOpFactoryCall {
  abstract readonly factoryName: string;
  abstract readonly operationClass: MigrationOperationClass;
  abstract readonly label: string;
  abstract toOp(): AnyMongoMigrationOperation | Promise<AnyMongoMigrationOperation>;

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

export class CastFieldCall extends OpFactoryCallNode {
  readonly factoryName = 'castField' as const;
  readonly collection: string;
  readonly field: string;
  readonly options: CastFieldOptions;
  readonly operationClass: MigrationOperationClass;
  readonly label: string;

  constructor(options: CastFieldOptions) {
    super();
    this.collection = options.collection;
    this.field = options.field;
    this.options = options;
    const op = this.toOp();
    this.operationClass = op.operationClass;
    this.label = op.label;
    this.freeze();
  }

  toOp(): MongoDmlOperation {
    return castField(this.options);
  }

  renderTypeScript(): string {
    return `castField(${jsonToTsSource(this.options)})`;
  }
}

/**
 * A data transform the planner scaffolds for a field: its check and its run's filter select the
 * documents still to change, and its update is a placeholder the user fills in `migration.ts`.
 * Until then `toOp()` rejects with `MIGRATION.UNFILLED_PLACEHOLDER`, naming the operation it stands
 * for, so the plan's other operations still list.
 */
export class DataTransformCall extends OpFactoryCallNode {
  readonly factoryName = 'dataTransform' as const;
  readonly operationClass = 'data' as const;
  readonly name: string;
  readonly collection: string;
  readonly filter: Document;
  readonly label: string;

  constructor(name: string, collection: string, filter: Document) {
    super();
    this.name = name;
    this.collection = collection;
    this.filter = filter;
    this.label = `Data transform: ${name}`;
    this.freeze();
  }

  get slot(): string {
    return `${this.name}:update`;
  }

  toOp(): Promise<never> {
    const unfilled = errorUnfilledPlaceholder(this.slot);
    const operation = Promise.reject(
      new CliStructuredError(unfilled.code, unfilled.message, {
        ...ifDefined('why', unfilled.why),
        ...ifDefined('fix', unfilled.fix),
        meta: {
          slot: this.slot,
          operation: {
            id: `data_transform.${this.name}`,
            label: this.label,
            operationClass: this.operationClass,
          },
        },
      }),
    );
    operation.catch(() => undefined);
    return operation;
  }

  renderTypeScript(): string {
    const collection = jsonToTsSource(this.collection);
    const filter = jsonToTsSource(this.filter);
    return [
      `dataTransform(${jsonToTsSource(this.name)}, {`,
      `  check: { source: () => rawAggregate(${collection}, [{ $match: ${filter} }, { $limit: 1 }]) },`,
      `  run: () => rawUpdateMany(${collection}, ${filter}, placeholder(${jsonToTsSource(this.slot)}), { bypassDocumentValidation: true }),`,
      '})',
    ].join('\n');
  }

  override importRequirements(): readonly ImportRequirement[] {
    return ['dataTransform', 'rawAggregate', 'rawUpdateMany', 'placeholder'].map((symbol) => ({
      moduleSpecifier: TARGET_MIGRATION_MODULE,
      symbol,
    }));
  }
}

export class FillFieldCall extends OpFactoryCallNode {
  readonly factoryName = 'fillField' as const;
  readonly operationClass = 'widening' as const;
  readonly collection: string;
  readonly field: string;
  readonly options: FillFieldOptions;
  readonly label: string;

  constructor(options: FillFieldOptions) {
    super();
    this.collection = options.collection;
    this.field = options.field;
    this.options = options;
    this.label = this.toOp().label;
    this.freeze();
  }

  toOp(): MongoDmlOperation {
    return fillField(this.options);
  }

  renderTypeScript(): string {
    return `fillField(${jsonToTsSource(this.options)})`;
  }
}

export class CheckDocumentsCall extends OpFactoryCallNode {
  readonly factoryName = 'checkDocuments' as const;
  readonly operationClass = 'widening' as const;
  readonly collection: string;
  readonly options: CheckDocumentsOptions;
  readonly label: string;

  constructor(options: CheckDocumentsOptions) {
    super();
    this.collection = options.collection;
    this.options = options;
    this.label = this.toOp().label;
    this.freeze();
  }

  toOp(): MongoMigrationPlanOperation {
    return checkDocuments(this.options);
  }

  renderTypeScript(validatorNames: ValidatorNames = new Map()): string {
    const entries = Object.entries(this.options).map(
      ([key, value]) =>
        [
          key,
          key === 'validator'
            ? validatorSource(this.collection, value, validatorNames)
            : jsonToTsSource(value),
        ] as const,
    );
    return `checkDocuments(${tsObjectSource(entries)})`;
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

  renderTypeScript(validatorNames: ValidatorNames = new Map()): string {
    const options = tsObjectSource(
      Object.entries(this.options)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [
          key,
          key === 'validator' && typeof value === 'object' && value !== null
            ? tsObjectSource(
                Object.entries(value).map(([validatorKey, validatorValue]) => [
                  validatorKey,
                  validatorKey === '$jsonSchema'
                    ? validatorSource(this.collection, validatorValue, validatorNames)
                    : jsonToTsSource(validatorValue),
                ]),
              )
            : jsonToTsSource(value),
        ]),
    );
    return this.meta
      ? `collMod(${jsonToTsSource(this.collection)}, ${options}, ${jsonToTsSource(this.meta)})`
      : `collMod(${jsonToTsSource(this.collection)}, ${options})`;
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
  | CastFieldCall
  | DataTransformCall
  | FillFieldCall
  | CheckDocumentsCall
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
