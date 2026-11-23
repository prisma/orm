import type { ControlPolicy } from '@internal/contract/types';
import { workspaceMigrationModule } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  contract,
  type FieldTypeSpec,
  NS,
  plan,
  planned,
  renameField,
  renameModel,
  schemaCollection,
} from './mongo-statement-fixtures';

interface UserSpec {
  readonly model?: string;
  readonly collection?: string;
  /** The stored name of `email`; its own name by default. */
  readonly email?: string;
  readonly fields?: readonly string[];
  readonly types?: Readonly<Record<string, FieldTypeSpec>>;
  readonly storedAs?: Readonly<Record<string, string>>;
  readonly control?: ControlPolicy;
}

/** One model, `User` in `users` by default, with an `email` field, whose validator requires every stored field. */
function users(seed: string, spec: UserSpec = {}) {
  const collection = spec.collection ?? 'users';
  const fields = spec.fields ?? ['email'];
  const storedAs: Readonly<Record<string, string>> = {
    ...(spec.email === undefined ? {} : { email: spec.email }),
    ...spec.storedAs,
  };
  return contract(
    seed,
    {
      [spec.model ?? 'User']: {
        collection,
        fields: ['_id', ...fields],
        storedAs,
        ...(spec.types === undefined ? {} : { types: spec.types }),
      },
    },
    {
      [collection]: {
        required: fields.map((field) => storedAs[field] ?? field),
        ...(spec.control === undefined ? {} : { control: spec.control }),
      },
    },
  );
}

const live = [schemaCollection('users', { required: ['email'] })];

/** The calls of the plan's migration.ts, without white space. */
function rendered(result: ReturnType<typeof plan>): readonly string[] {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const source = (result.plan as PlannerProducedMongoMigration)
    .renderTypeScript(workspaceMigrationModule.mongo)
    .replace(/\s+/g, '');
  return source.match(/(?:renameCollection|renameField)\((?:[^()]|\([^()]*\))*\)/g) ?? [];
}

describe('MongoMigrationPlanner, a model and field whose names both contracts keep', () => {
  it('renames the collection of a model whose @@map changes, and reports no statement', () => {
    expect(
      planned(
        plan({ from: users('from'), to: users('to', { collection: 'app_users' }), schema: live }),
      ),
    ).toEqual({
      labels: ['Rename collection users to app_users'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
    });
  });

  it('renames the stored field of a field whose @map changes', () => {
    expect(
      planned(
        plan({ from: users('from'), to: users('to', { email: 'email_address' }), schema: live }),
      ),
    ).toEqual({
      labels: [
        'Rename field email to email_address in collection users',
        'Update validator on users (added: email_address; removed: email)',
      ],
      classes: ['widening', 'widening'],
      applied: [],
      dataLoss: [],
    });
  });

  it('renames the collection first, then the field in the renamed collection', () => {
    const result = plan({
      from: users('from'),
      to: users('to', { collection: 'app_users', email: 'email_address' }),
      schema: live,
    });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: [
        'Rename collection users to app_users',
        'Rename field email to email_address in collection app_users',
        'Update validator on app_users (added: email_address; removed: email)',
      ],
      classes: ['widening', 'widening', 'widening'],
      applied: [],
      dataLoss: [],
      rendered: [
        'renameCollection("users","app_users")',
        'renameField("app_users","email","email_address")',
      ],
    });
  });

  it('renders the same calls a statement renders for the same stored names', () => {
    const stated = plan({
      from: users('from', { model: 'Account' }),
      to: users('to', { collection: 'app_users', email: 'email_address' }),
      schema: live,
      statements: [renameModel('Account', 'User')],
    });
    const kept = plan({
      from: users('from'),
      to: users('to', { collection: 'app_users', email: 'email_address' }),
      schema: live,
    });
    expect(rendered(kept)).toEqual(rendered(stated));
  });

  it('renames the collection before a field statement, which renames the field in the renamed collection', () => {
    expect(
      planned(
        plan({
          from: users('from'),
          to: users('to', { collection: 'app_users', fields: ['mail'] }),
          schema: live,
          statements: [renameField('User', 'email', 'User', 'mail')],
        }),
      ),
    ).toEqual({
      labels: [
        'Rename collection users to app_users',
        'Rename field email to mail in collection app_users',
        'Update validator on app_users (added: mail; removed: email)',
      ],
      classes: ['widening', 'widening', 'widening'],
      applied: [[1]],
      dataLoss: [],
    });
  });

  it('renames the field before the cast of its changed type, which casts the new stored name', () => {
    expect(
      planned(
        plan({
          from: users('from', { fields: ['age'], types: { age: { codecId: 'mongo/int32@1' } } }),
          to: users('to', {
            fields: ['age'],
            types: { age: { codecId: 'mongo/int64@1' } },
            storedAs: { age: 'years' },
          }),
          schema: [schemaCollection('users', { required: ['age'] })],
        }),
      ),
    ).toEqual({
      labels: [
        'Rename field age to years in collection users',
        'Cast field years in collection users from int to long',
        'Update validator on users (added: years; removed: age)',
      ],
      classes: ['widening', 'widening', 'widening'],
      applied: [],
      dataLoss: [],
    });
  });

  it('removes a field the destination drops from the renamed collection, asked about by its origin model and field', () => {
    expect(
      planned(
        plan({
          from: users('from', { fields: ['email', 'name'] }),
          to: users('to', { collection: 'app_users' }),
          schema: [schemaCollection('users', { required: ['email', 'name'] })],
        }),
      ),
    ).toEqual({
      labels: [
        'Rename collection users to app_users',
        'Remove field name from collection app_users',
        'Update validator on app_users (removed: name)',
      ],
      classes: ['widening', 'destructive', 'widening'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 1,
          subject: { kind: 'field', namespaceId: NS, model: 'User', field: 'name' },
          loss: 'drop',
          label: 'Remove field name from collection app_users',
        },
      ],
    });
  });

  it('fills a new required field in the renamed collection', () => {
    const result = plan({
      from: users('from'),
      to: users('to', { collection: 'app_users', fields: ['email', 'name'] }),
      schema: live,
    });
    expect({
      ...planned(result),
      temporaryValues: result.kind === 'success' ? result.temporaryValues : result,
    }).toEqual({
      labels: [
        'Rename collection users to app_users',
        'Fill field name in collection app_users where it is missing or null',
        'Update validator on app_users (added: name)',
      ],
      classes: ['widening', 'widening', 'widening'],
      applied: [],
      dataLoss: [],
      temporaryValues: [
        {
          operationIndex: 1,
          subject: { kind: 'field', namespaceId: NS, model: 'User', field: 'name' },
          value: '""',
        },
      ],
    });
  });

  it('renames the stored field of a field that keeps its name on a model a statement renames', () => {
    expect(
      planned(
        plan({
          from: users('from', { model: 'Account' }),
          to: users('to', { collection: 'app_users', email: 'email_address' }),
          schema: live,
          statements: [renameModel('Account', 'User')],
        }),
      ),
    ).toEqual({
      labels: [
        'Rename collection users to app_users',
        'Rename field email to email_address in collection app_users',
        'Update validator on app_users (added: email_address; removed: email)',
      ],
      classes: ['widening', 'widening', 'widening'],
      applied: [[0]],
      dataLoss: [],
    });
  });

  it('plans a new model in the collection a rename frees', () => {
    const to = contract(
      'to',
      {
        User: { collection: 'app_users', fields: ['_id', 'email'] },
        Legacy: { collection: 'users', fields: ['_id', 'note'] },
      },
      { app_users: { required: ['email'] }, users: { required: ['note'] } },
    );
    expect(planned(plan({ from: users('from'), to, schema: live }))).toEqual({
      labels: ['Rename collection users to app_users', 'Create collection users'],
      classes: ['widening', 'additive'],
      applied: [],
      dataLoss: [],
    });
  });

  it('plans as without the rename when the old collection is not managed in the origin contract', () => {
    expect(
      planned(
        plan({
          from: users('from', { control: 'external' }),
          to: users('to', { collection: 'app_users' }),
          schema: live,
        }),
      ),
    ).toEqual({
      labels: ['Create collection app_users'],
      classes: ['additive'],
      applied: [],
      dataLoss: [],
    });
  });

  it('plans as without the rename, and advises renaming by hand, when the new collection is not managed in the destination contract', () => {
    expect(
      planned(
        plan({
          from: users('from'),
          to: users('to', { collection: 'app_users', control: 'external' }),
          schema: live,
        }),
      ),
    ).toEqual({
      labels: ['Drop collection users'],
      classes: ['destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 0,
          subject: { kind: 'model', namespaceId: NS, model: 'User' },
          loss: 'drop',
          label: 'Drop collection users',
          keepDataAdvice:
            'To keep its documents, rename collection "users" to "app_users" instead. The plan does not rename it: a plan renames the collection of a model that keeps its name only when the control policy of the collection is "managed" in both contracts. With db update, rename the collection in the database yourself, for example db.getCollection("users").renameCollection("app_users") in mongosh, then run db update. With migration plan, plan it, passing --delete User to answer its question; in its migration.ts make renameCollection("users", "app_users") the first operation, imported with the other operations, delete the drop of "users", and delete the create of "app_users" if there is one; run node on that migration.ts so it writes ops.json again; then apply it with prisma db migrate.',
        },
      ],
    });
  });

  it('plans as without the rename when the plan has no origin contract', () => {
    expect(
      planned(plan({ from: null, to: users('to', { collection: 'app_users' }), schema: live })),
    ).toEqual({
      labels: ['Create collection app_users', 'Drop collection users'],
      classes: ['additive', 'destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 1,
          subject: { kind: 'storage', name: 'users' },
          loss: 'drop',
          label: 'Drop collection users',
        },
      ],
    });
  });

  it('plans as without the rename when the schema being planned from lacks the old collection', () => {
    expect(
      planned(
        plan({
          from: users('from'),
          to: users('to', { collection: 'app_users' }),
          schema: [schemaCollection('app_users', { required: ['email'] })],
        }),
      ),
    ).toEqual({ labels: [], classes: [], applied: [], dataLoss: [] });
  });
});

describe('MongoMigrationPlanner, a name both contracts keep whose storage MongoDB cannot rename', () => {
  const readings = (seed: string, collection: string, at: string) =>
    contract(
      seed,
      {
        Reading: {
          collection,
          fields: ['_id', 'at', 'value'],
          storedAs: { value: at },
        },
      },
      { [collection]: { timeField: 'at' } },
    );
  const liveReadings = [schemaCollection('readings', { timeseries: true })];

  it('refuses the rename of a time-series collection, naming the contract change and no statement', () => {
    expect(
      plan({
        from: readings('from', 'readings', 'value'),
        to: readings('to', 'measurements', 'value'),
        schema: liveReadings,
      }),
    ).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename collection "readings" to "measurements": collection "readings" is a time-series collection',
          why: 'The collection of model "Reading" changes from "readings" to "measurements", and MongoDB cannot rename a time-series collection. Keep the collection\'s name: store the models in "readings" (with @@map("readings") in PSL), then run this command again.',
        },
      ],
    });
  });

  it('refuses the rename of a field of a time-series collection, naming the contract change and no statement', () => {
    expect(
      plan({
        from: readings('from', 'readings', 'value'),
        to: readings('to', 'readings', 'reading'),
        schema: liveReadings,
      }),
    ).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename field "value" to "reading" in collection "readings": collection "readings" is a time-series collection',
          why: 'The stored name of field "Reading.value" changes from "value" to "reading", and MongoDB updates the documents of a time-series collection only through its metaField, so the plan cannot move the values of a field in them. Keep the stored name: store the field as "value" (with @map("value") in PSL), then run this command again.',
        },
      ],
    });
  });

  it('refuses the rename of a stored name MongoDB reads as a path, naming the contract change and no statement', () => {
    expect(
      plan({
        from: users('from', { email: 'contact.email' }),
        to: users('to', { email: 'email' }),
        schema: [schemaCollection('users', { required: ['contact.email'] })],
      }),
    ).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename field "contact.email" to "email" in collection "users": the stored name "contact.email" cannot be rewritten',
          why: 'The stored name of field "User.email" changes from "contact.email" to "email". MongoDB reads a name containing "." as a path into embedded documents, so the plan cannot move its values. Keep the stored name "contact.email" (with @map("contact.email") in PSL), then run this command again.',
        },
      ],
    });
  });
});
