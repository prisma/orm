import { onlySchema, seedOfRun } from './property-options';
import { emitContract, type Schema, schemas, type Target } from './schemas';

export interface EmittedSchema {
  readonly schema: Schema;
  readonly contractJson: unknown;
  readonly seed: number;
}

export const exercisedByEverySuite: readonly string[] = [
  'compared without returning',
  'compared with one query per included relation',
  'compared without returning and with one query per included relation',
  'read include with one query per included relation',
  'update include with one query per included relation',
  'update include without returning and with one query per included relation',
  'create changed',
  'createAll changed',
  'update changed',
  'updateAll changed',
  'delete changed',
  'deleteAll changed',
  'upsert changed',
  'read unchanged',
  'create depth 2',
  'update include depth 2',
  'read include depth 2',
  'update select',
  'update on single key',
  'update on composite key',
  'delete on composite key',
  'create on composite key',
  'schema with 1:n',
  'schema with 1:1',
  'schema with n:m',
  'schema with 1:n to itself',
  'schema with composite foreign key',
  'schema with required relation',
];

export const exercisedWithManySequences: readonly string[] = [
  'schema with variant in its own table',
  'schema with variant in the base table',
  'create on a variant in the base table',
  'update on a variant in the base table',
  'update on a variant in its own table',
  'delete on a variant in its own table',
  'some related through 1:n',
  'none related through n:1',
  'every related through n:m',
  'some related through 1:1 other',
  'create through 1:n',
  'create through n:1',
  'create through n:m',
  'create through 1:1 holder',
  'create through 1:1 other',
  'connect through 1:n',
  'connect through n:1',
  'connect through n:m',
  'disconnect through 1:n',
  'disconnect through n:1',
  'disconnect through n:m',
  'updateAll through 1:n',
  'updateAll through n:m',
  'deleteAll through 1:n',
  'deleteAll through n:m',
];

export async function onEachSchema(
  target: Target,
  count: number,
  run: (emitted: EmittedSchema) => Promise<void>,
): Promise<void> {
  const seed = seedOfRun();
  const only = onlySchema();
  for (const [index, schema] of schemas(target, count, seed).entries()) {
    if (only !== undefined && only !== index) continue;
    const contractJson = emitContract(schema, `${target}-${process.pid}-${index}`);
    try {
      await run({ schema, contractJson, seed: seed + index });
    } catch (error) {
      throw new Error(
        `the two paths disagree on schema ${index} of seed ${seed} (ORM_PATHS_SEED=${seed} ORM_PATHS_SCHEMA=${index}):\n${schema.psl}`,
        { cause: error },
      );
    }
  }
}
