import { workspaceMigrationModule } from '@repo/test-utils';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  type CollectionSpec,
  contract,
  type EnumSpec,
  type FieldTypeSpec,
  type ModelSpec,
  type plan,
  schemaCollection,
} from './mongo-statement-fixtures';

export const STATUS: FieldTypeSpec = { codecId: 'mongo/string@1', valueSet: 'Status' };
export const TYPES = { status: { ...STATUS, nullable: true }, tags: { ...STATUS, many: true } };

/** Users whose fields `types` names are typed by `Status`. */
export function users(
  seed: string,
  members: Readonly<Record<string, unknown>>,
  options: {
    readonly types?: Readonly<Record<string, FieldTypeSpec>>;
    readonly codecId?: string;
    readonly collection?: CollectionSpec;
    readonly models?: Readonly<Record<string, ModelSpec>>;
    readonly valueObjects?: Readonly<Record<string, Readonly<Record<string, FieldTypeSpec>>>>;
  } = {},
) {
  const types = options.types ?? TYPES;
  const status: EnumSpec = {
    members,
    ...(options.codecId === undefined ? {} : { codecId: options.codecId }),
  };
  return contract(
    seed,
    {
      User: { collection: 'users', fields: ['_id', ...Object.keys(types)], types },
      ...options.models,
    },
    { users: options.collection ?? {} },
    options.valueObjects ?? {},
    { Status: status },
  );
}

export const live = [schemaCollection('users')];

/** The stored value calls of the plan's migration.ts, without white space. */
export function rendered(result: ReturnType<typeof plan>): readonly string[] {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const source = (result.plan as PlannerProducedMongoMigration)
    .renderTypeScript(workspaceMigrationModule.mongo)
    .replace(/\s+/g, '')
    .replace(/,\}/g, '}');
  return source.match(/(?:replace|remove)StoredValue\(\{(?:[^{}]|\{[^{}]*\})*\}\)/g) ?? [];
}

export function refused(result: ReturnType<typeof plan>) {
  if (result.kind !== 'failure') throw new Error('Expected the plan to be refused');
  return result.conflicts;
}

/** Users with a nullable boolean `flag` and a list `flags` typed by a boolean `Status`, or by no enum when `members` is left out. */
export function flags(seed: string, members?: Readonly<Record<string, unknown>>) {
  const typed = (extra: Partial<FieldTypeSpec>) => ({
    codecId: 'mongo/bool@1',
    ...(members === undefined ? {} : { valueSet: 'Status' }),
    ...extra,
  });
  return contract(
    seed,
    {
      User: {
        collection: 'users',
        fields: ['_id', 'flag', 'flags'],
        types: { flag: typed({ nullable: true }), flags: typed({ many: true }) },
      },
    },
    { users: {} },
    {},
    members === undefined ? {} : { Status: { codecId: 'mongo/bool@1', members } },
  );
}
