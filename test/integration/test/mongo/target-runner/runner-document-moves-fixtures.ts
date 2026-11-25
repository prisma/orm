import { introspectSchema } from '@internal/adapter-mongo/control';
import type { MigrationOperationPolicy } from '@internal/framework-components/control';
import type { MongoContract } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { MongoMigrationPlanner } from '@internal/target-mongo/control';
import { dataTransform, deleteDocuments, rawAggregate } from '@internal/target-mongo/migration';
import { closedSchema, useStatementsDatabase } from './runner-statements-fixtures';

export const policy: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};
export const USERS = { $match: { user: { $exists: true } } };
export const GUEST_ONLY = closedSchema(['guest']);
export const GUEST_OR_MEMBER = { bsonType: 'object', anyOf: [GUEST_ONLY, closedSchema(['user'])] };

/** The move of `User`'s documents out of `users`, as the refusal of `--rename User:Member` gives it. */
export const move = [
  dataTransform('move User to members', {
    run: () =>
      rawAggregate('users', [USERS, { $merge: { into: 'members' } }], {
        bypassDocumentValidation: true,
      }),
  }),
  deleteDocuments({ collection: 'users', filter: { user: { $exists: true } } }),
];

/**
 * The operations a route prints, in order, as a user pastes them: each `rawAggregate` call as the
 * run of its own `dataTransform`, and each `deleteDocuments` call. The filter placeholder of the
 * n-th call becomes `filters[n]`.
 */
export function pastedOperations(
  route: string,
  filters: readonly Record<string, unknown>[],
): readonly AnyMongoMigrationOperation[] {
  const calls = [
    ...route.matchAll(/\n {2}(rawAggregate\([\s\S]*?\n {2}\]\)|deleteDocuments\(.*\))/g),
  ].map((match) => match[1] ?? '');
  if (calls.length !== filters.length) {
    throw new Error(`Expected ${filters.length} calls in the route, found ${calls.length}`);
  }
  return calls.map((call, index) => {
    const pasted: {
      copy?: ReturnType<typeof rawAggregate>;
      delete?: ReturnType<typeof deleteDocuments>;
    } = {};
    new Function(
      'rawAggregate',
      'deleteDocuments',
      'filter',
      call.replace(/<a filter[^>]*>|<the same filter>/, 'filter'),
    )(
      (...args: Parameters<typeof rawAggregate>) => {
        pasted.copy = rawAggregate(...args);
      },
      (...args: Parameters<typeof deleteDocuments>) => {
        pasted.delete = deleteDocuments(...args);
      },
      filters[index],
    );
    const { copy } = pasted;
    if (copy !== undefined) return dataTransform(`pasted copy ${index}`, { run: () => copy });
    if (pasted.delete === undefined) throw new Error(`Cannot evaluate ${call}`);
    return pasted.delete;
  });
}

/** The database of a document-moves test file, with the helpers that plan from it and run against it. */
export function useDocumentMovesDatabase(dbName: string) {
  const statements = useStatementsDatabase(dbName);
  const { db, documents, runOperations } = statements;

  async function plannedOperations(from: MongoContract, to: MongoContract) {
    const planned = new MongoMigrationPlanner().plan({
      contract: to,
      schema: await introspectSchema(db()),
      policy,
      fromContract: from,
      origin: { storageHash: from.storage.storageHash },
      statements: [],
      frameworkComponents: [],
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error(JSON.stringify(planned.conflicts, null, 2));
    return planned.plan.operations as readonly AnyMongoMigrationOperation[];
  }

  /** Runs `operations`, stopping when the one labelled `stopAt` starts, and reports whether it stopped. */
  async function runStoppingAt(
    operations: readonly AnyMongoMigrationOperation[],
    from: MongoContract,
    to: MongoContract,
    stopAt: string,
  ) {
    const stop = new Error(`stopped at ${stopAt}`);
    return runOperations(operations, from, to, {
      policy,
      callbacks: {
        onOperationStart: (operation) => {
          if (operation.label === stopAt) throw stop;
        },
      },
    }).then(
      () => 'ran',
      (error: unknown) => (error === stop ? 'stopped' : error),
    );
  }

  async function bothCollections() {
    return { users: await documents('users'), members: await documents('members') };
  }

  return { ...statements, plannedOperations, runStoppingAt, bothCollections };
}
