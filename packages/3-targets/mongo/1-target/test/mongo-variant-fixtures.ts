import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { workspaceMigrationModule } from '@repo/test-utils';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  type CollectionSpec,
  contract,
  type EnumSpec,
  type FieldTypeSpec,
  type ModelSpec,
  NS,
  type plan,
  schemaCollection,
} from './mongo-statement-fixtures';

export interface VariantSpec {
  readonly value: string;
  readonly fields?: readonly string[];
}

export interface TaskOptions {
  /** The base's discriminator field; `type` by default. */
  readonly discriminator?: string;
  /** The discriminator field's type; a string by default. */
  readonly discriminatorType?: FieldTypeSpec;
  /** Other models stored in the collection. */
  readonly models?: Readonly<Record<string, ModelSpec>>;
  readonly enums?: Readonly<Record<string, EnumSpec>>;
}

/** Tasks discriminated by `type`, each variant stored in the base's collection with its own fields. */
export function tasks(
  seed: string,
  variants: Readonly<Record<string, VariantSpec>>,
  collection: CollectionSpec = {},
  options: TaskOptions = {},
) {
  const discriminator = options.discriminator ?? 'type';
  const models: Record<string, ModelSpec> = {
    Task: {
      collection: 'tasks',
      fields: ['_id', discriminator],
      ...(options.discriminatorType === undefined
        ? {}
        : { types: { [discriminator]: options.discriminatorType } }),
      discriminator,
      variants: Object.fromEntries(
        Object.entries(variants).map(([name, { value }]) => [name, value]),
      ),
    },
    ...options.models,
  };
  for (const [name, { fields }] of Object.entries(variants)) {
    models[name] = { collection: 'tasks', fields: fields ?? [], base: 'Task' };
  }
  return contract(seed, models, { tasks: collection }, {}, options.enums);
}

export const BUG: VariantSpec = { value: 'bug', fields: ['severity'] };
export const EPIC: VariantSpec = { value: 'epic', fields: ['scope'] };
export const BEFORE = tasks('from', { Bug: BUG, Epic: EPIC });
export const live = [schemaCollection('tasks')];

export const convert = (model: string): ResolvedMigrationStatement => ({
  kind: 'convert',
  entity: 'model',
  model: { namespaceId: NS, model },
});

export const bugModel = { kind: 'model' as const, namespaceId: NS, model: 'Bug' };

/** The variant calls of the plan's migration.ts, without white space. */
export function rendered(result: ReturnType<typeof plan>): readonly string[] {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const source = (result.plan as PlannerProducedMongoMigration)
    .renderTypeScript(workspaceMigrationModule.mongo)
    .replace(/\s+/g, '')
    .replace(/,\}/g, '}');
  return (
    source.match(
      /(?:replaceStoredValue|deleteDocuments|unsetField)\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/g,
    ) ?? []
  );
}

export const ONE_AT_A_TIME =
  "MongoDB applies a migration's operations one at a time, without a transaction, and knows that an operation already ran only from the documents.";

export const TWO_MIGRATIONS = `${ONE_AT_A_TIME} An operation that reads a value another operation of the same migration writes acts on what that operation wrote: at once when it runs later, and when the migration runs again after a later operation stops. Make the change as two changes to the contract, and apply the first, by a migration or by db update, before you make the second: first delete the variants, or move their values to discriminator values no variant uses; then change the values to their final ones.`;

export const replaceLabel = (from: string, to: string, field = 'type') =>
  `Replace value "${from}" with "${to}" in field ${field} of collection tasks`;

export const deleteLabel = (value: string, field = 'type') =>
  `Delete the documents of collection tasks whose ${field} is "${value}"`;
