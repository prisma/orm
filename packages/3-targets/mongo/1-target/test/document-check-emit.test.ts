import { Migration as MongoMigration } from '@internal/family-mongo/migration';
import { Migration } from '@internal/migration-tools/migration';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { RawAggregateCommand } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { checkDocuments, collMod, fillField } from '../src/core/migrations/migration-factories';

function validatorChange(required: readonly string[]) {
  return collMod(
    'users',
    { validator: { $jsonSchema: { bsonType: 'object', required: ['_id', ...required] } } },
    { id: `validator.users.update.${required.join('.')}`, checkDocuments: true },
  );
}

function migrationOf(operations: readonly AnyMongoMigrationOperation[]) {
  return new (class extends MongoMigration {
    override describe() {
      return { from: 'a', to: 'b' };
    }

    override get operations() {
      return operations;
    }
  })();
}

/** The validator the emitted check of the migration's first operation matches against. */
function checkedValidator(migration: MongoMigration): unknown {
  const [check] = Migration.readOperations(migration) as readonly (
    | AnyMongoMigrationOperation
    | Promise<AnyMongoMigrationOperation>
  )[];
  if (check === undefined || check instanceof Promise) throw new Error('Expected a check');
  const [precheck] = check.precheck;
  const command = precheck && 'command' in precheck.source ? precheck.source.command : undefined;
  if (!(command instanceof RawAggregateCommand)) throw new Error('Expected an aggregate');
  return command.pipeline[0];
}

describe('a checkDocuments call, when its migration emits its operations', () => {
  const check = () => checkDocuments({ collection: 'users', rewrittenFields: ['plan'] });
  const fill = () => fillField({ collection: 'users', field: 'plan', value: { $literal: '' } });

  it('checks against the first validator change of its collection after it, edited by hand or not', () => {
    expect(
      checkedValidator(
        migrationOf([
          check(),
          fill(),
          validatorChange(['email', 'plan']),
          validatorChange(['name']),
        ]),
      ),
    ).toEqual({
      $match: { $nor: [{ $jsonSchema: { bsonType: 'object', required: ['_id', 'email'] } }] },
    });
  });

  it('cannot be emitted when its only validator change is in the next migration', () => {
    const first = migrationOf([check(), fill()]);
    const next = migrationOf([validatorChange(['email', 'plan'])]);

    expect(() => Migration.readOperations(first)).toThrow(
      'checkDocuments on collection users has no validator change of that collection after it in the same migration.',
    );
    expect(() => Migration.readOperations(next)).not.toThrow();
  });

  it('gives the same operations on every read', () => {
    const migration = migrationOf([check(), fill(), validatorChange(['email', 'plan'])]);

    expect(JSON.stringify(Migration.readOperations(migration))).toBe(
      JSON.stringify(Migration.readOperations(migration)),
    );
  });
});
