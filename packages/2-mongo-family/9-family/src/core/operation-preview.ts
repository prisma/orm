import type {
  MigrationPlanOperation,
  OperationPreview,
} from '@internal/framework-components/control';
import type {
  AnyMongoDdlCommand,
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
  MongoDdlCommandVisitor,
  MongoIndexKey,
  RenameCollectionCommand,
} from '@internal/mongo-query-ast/control';
import type { RawUpdateManyCommand } from '@internal/mongo-query-ast/execution';
import { fieldRewriteOf } from './field-rewrite';

function formatKeySpec(keys: ReadonlyArray<MongoIndexKey>): string {
  const entries = keys.map((k) => `${JSON.stringify(k.field)}: ${JSON.stringify(k.direction)}`);
  return `{ ${entries.join(', ')} }`;
}

const COMMAND_META_KEYS = new Set(['kind', 'collection', 'keys']);

function formatOptionEntries(cmd: object): string | undefined {
  const parts = Object.entries(cmd)
    .filter(([key, value]) => !COMMAND_META_KEYS.has(key) && value !== undefined)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  if (parts.length === 0) return undefined;
  return `{ ${parts.join(', ')} }`;
}

function formatOptions(cmd: CreateIndexCommand): string | undefined {
  return formatOptionEntries(cmd);
}

function formatCreateCollectionOptions(cmd: CreateCollectionCommand): string | undefined {
  return formatOptionEntries(cmd);
}

function collectionRef(name: string): string {
  return `db.getCollection(${JSON.stringify(name)})`;
}

class MongoDdlCommandFormatter implements MongoDdlCommandVisitor<string> {
  createIndex(cmd: CreateIndexCommand): string {
    const keySpec = formatKeySpec(cmd.keys);
    const opts = formatOptions(cmd);
    return opts
      ? `${collectionRef(cmd.collection)}.createIndex(${keySpec}, ${opts})`
      : `${collectionRef(cmd.collection)}.createIndex(${keySpec})`;
  }

  dropIndex(cmd: DropIndexCommand): string {
    return `${collectionRef(cmd.collection)}.dropIndex(${JSON.stringify(cmd.name)})`;
  }

  createCollection(cmd: CreateCollectionCommand): string {
    const opts = formatCreateCollectionOptions(cmd);
    return opts
      ? `db.createCollection(${JSON.stringify(cmd.collection)}, ${opts})`
      : `db.createCollection(${JSON.stringify(cmd.collection)})`;
  }

  dropCollection(cmd: DropCollectionCommand): string {
    return `${collectionRef(cmd.collection)}.drop()`;
  }

  renameCollection(cmd: RenameCollectionCommand): string {
    return `${collectionRef(cmd.collection)}.renameCollection(${JSON.stringify(cmd.to)})`;
  }

  collMod(cmd: CollModCommand): string {
    const parts: string[] = [`collMod: ${JSON.stringify(cmd.collection)}`];
    for (const [key, value] of Object.entries(cmd)) {
      if (!COMMAND_META_KEYS.has(key) && value !== undefined)
        parts.push(`${key}: ${JSON.stringify(value)}`);
    }
    return `db.runCommand({ ${parts.join(', ')} })`;
  }
}

const formatter = new MongoDdlCommandFormatter();

function formatUpdateMany(cmd: RawUpdateManyCommand): string {
  const args = [JSON.stringify(cmd.filter), JSON.stringify(cmd.update)];
  if (cmd.bypassDocumentValidation) args.push('{ bypassDocumentValidation: true }');
  return `${collectionRef(cmd.collection)}.updateMany(${args.join(', ')})`;
}

function arrayAt(value: object, key: string): readonly unknown[] {
  const entry: unknown = Reflect.get(value, key);
  return Array.isArray(entry) ? entry : [];
}

function objectAt(value: unknown, key: string): object | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const entry: unknown = Reflect.get(value, key);
  return typeof entry === 'object' && entry !== null ? entry : undefined;
}

function isDdlCommand(value: object | undefined): value is AnyMongoDdlCommand {
  return value !== undefined && typeof Reflect.get(value, 'accept') === 'function';
}

export function formatMongoOperations(operations: readonly MigrationPlanOperation[]): string[] {
  const statements: string[] = [];
  for (const operation of operations) {
    for (const step of arrayAt(operation, 'execute')) {
      const command = objectAt(step, 'command');
      if (isDdlCommand(command)) statements.push(command.accept(formatter));
    }
    const rewrite = fieldRewriteOf(operation);
    if (rewrite !== undefined) statements.push(formatUpdateMany(rewrite.command));
  }
  return statements;
}

/**
 * Wraps `formatMongoOperations` into the family-agnostic
 * `OperationPreview` shape. Each statement carries
 * `language: 'mongodb-shell'`. Mirrors `sqlOperationsToPreview`.
 */
export function mongoOperationsToPreview(
  operations: readonly MigrationPlanOperation[],
): OperationPreview {
  return {
    statements: formatMongoOperations(operations).map((text) => ({
      text,
      language: 'mongodb-shell',
    })),
  };
}
