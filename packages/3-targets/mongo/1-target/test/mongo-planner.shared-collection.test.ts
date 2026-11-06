import { describe, expect, it } from 'vitest';
import {
  contract,
  type ModelSpec,
  plan,
  planned,
  refusal,
  renameField,
  schemaCollection,
  sharedJsonSchema,
} from './mongo-statement-fixtures';

const shared = (seed: string, admin: readonly string[], user: readonly string[]) =>
  contract(
    seed,
    {
      Admin: { collection: 'users', fields: ['_id', ...admin] },
      User: { collection: 'users', fields: ['_id', ...user] },
    },
    { users: { jsonSchema: sharedJsonSchema(admin, user) } },
  );

describe('MongoMigrationPlanner, a collection that stores several root models', () => {
  it('unsets nothing without an origin contract when the anyOf validator still declares the field', () => {
    expect(
      planned(
        plan({
          from: null,
          to: shared('to', ['level'], ['email']),
          schema: [schemaCollection('users', { required: ['level'] })],
        }),
      ),
    ).toEqual({
      labels: ['Update validator on users (added: email)'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
    });
  });

  it('unsets a field without an origin contract when no branch of the anyOf validator declares it', () => {
    expect(
      planned(
        plan({
          from: null,
          to: shared('to', ['level'], ['email']),
          schema: [
            schemaCollection('users', {
              jsonSchema: sharedJsonSchema(['level', 'nickname'], ['email']),
            }),
          ],
        }),
      ),
    ).toEqual({
      labels: [
        'Remove field nickname from collection users',
        'Update validator on users (removed: nickname)',
      ],
      classes: ['destructive', 'widening'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 0,
          subject: { kind: 'storage', name: 'users.nickname' },
          loss: 'drop',
          label: 'Remove field nickname from collection users',
        },
      ],
    });
  });
});

const SEPARATE =
  'move the models to separate collections, or carry out the change in a dataTransform operation of a migration.ts, with a filter that selects only their documents';

describe('MongoMigrationPlanner, field changes in a collection that stores several root models', () => {
  const schema = [
    schemaCollection('users', { jsonSchema: sharedJsonSchema(['level'], ['level']) }),
  ];

  it('refuses to rename a field another root model of the collection stores', () => {
    expect(
      refusal(
        plan({
          from: shared('from', ['level'], ['level']),
          to: shared('to', ['rank'], ['level']),
          schema,
          statements: [renameField('Admin', 'level', 'Admin', 'rank')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename field "Admin.level" to "Admin.rank": model "User" stores field "level" in the same collection, "users"',
        why: `Collection "users" stores several models and no discriminator tells their documents apart, so renaming the field would rename it in the documents of "User" too. To change it, ${SEPARATE}.`,
      },
    ]);
  });

  it('renames a field that every root model of the collection renames to the same name', () => {
    expect(
      planned(
        plan({
          from: shared('from', ['level'], ['level']),
          to: shared('to', ['rank'], ['rank']),
          schema,
          statements: [
            renameField('Admin', 'level', 'Admin', 'rank'),
            renameField('User', 'level', 'User', 'rank'),
          ],
        }),
      ),
    ).toEqual({
      labels: [
        'Rename field level to rank in collection users',
        'Update validator on users (added: rank; removed: level)',
      ],
      classes: ['widening', 'widening'],
      applied: [[0], [0]],
      dataLoss: [],
    });
  });

  it('refuses a field rename when another root model renames the field to another name', () => {
    expect(
      refusal(
        plan({
          from: shared('from', ['level'], ['level']),
          to: shared('to', ['rank'], ['grade']),
          schema,
          statements: [
            renameField('Admin', 'level', 'Admin', 'rank'),
            renameField('User', 'level', 'User', 'grade'),
          ],
        }),
      ).map(({ summary }) => summary),
    ).toEqual([
      'Cannot rename field "Admin.level" to "Admin.rank": model "User" stores field "level" in the same collection, "users"',
      'Cannot rename field "User.level" to "User.grade": model "Admin" stores field "level" in the same collection, "users"',
    ]);
  });

  it('renames a field no other root model of the collection stores', () => {
    expect(
      planned(
        plan({
          from: shared('from', ['level'], ['email']),
          to: shared('to', ['rank'], ['email']),
          schema: [
            schemaCollection('users', { jsonSchema: sharedJsonSchema(['level'], ['email']) }),
          ],
          statements: [renameField('Admin', 'level', 'Admin', 'rank')],
        }),
      ).labels[0],
    ).toBe('Rename field level to rank in collection users');
  });

  it('refuses to remove a field another root model of the collection still stores', () => {
    expect(
      refusal(
        plan({
          from: shared('from', ['level'], ['level']),
          to: shared('to', [], ['level']),
          schema,
        }),
      ),
    ).toEqual([
      {
        kind: 'fieldRemovalRefused',
        summary:
          'Cannot remove field "level" of model "Admin" from collection "users": model "User" stores it in the same collection',
        why: `Collection "users" stores several models and no discriminator tells their documents apart, so removing the field would remove it from the documents of "User" too. To keep it in "User" documents only, ${SEPARATE}.`,
      },
    ]);
  });

  it('refuses to remove a base field another root model stores when a variant of the base keeps it', () => {
    const withVariants = (seed: string, admin: readonly string[]) =>
      contract(
        seed,
        {
          Admin: {
            collection: 'users',
            fields: ['_id', 'kind', ...admin],
            discriminator: 'kind',
            variants: { SuperAdmin: 'super' },
          },
          SuperAdmin: { collection: 'users', fields: ['level'], base: 'Admin' },
          User: { collection: 'users', fields: ['_id', 'level'] },
        },
        { users: { jsonSchema: sharedJsonSchema(['kind', 'level'], ['level']) } },
      );
    expect(
      refusal(
        plan({
          from: withVariants('from', ['level']),
          to: withVariants('to', []),
          schema: [
            schemaCollection('users', {
              jsonSchema: sharedJsonSchema(['kind', 'level'], ['level']),
            }),
          ],
        }),
      ).map(({ summary }) => summary),
    ).toEqual([
      'Cannot remove field "level" of model "Admin" from collection "users": model "User" stores it in the same collection',
    ]);
  });

  describe('a variant whose discriminator filter other models in the collection can match', () => {
    const schema = [
      schemaCollection('users', { jsonSchema: sharedJsonSchema(['kind', 'level'], ['level']) }),
    ];
    const models = (superFields: readonly string[], other: Record<string, ModelSpec>) =>
      ({
        Admin: {
          collection: 'users',
          fields: ['_id', 'kind'],
          discriminator: 'kind',
          variants: { SuperAdmin: 'super' },
        },
        SuperAdmin: { collection: 'users', fields: superFields, base: 'Admin' },
        ...other,
      }) satisfies Record<string, ModelSpec>;
    const plainWithKind = (fields: readonly string[]) => ({
      User: { collection: 'users', fields: ['_id', 'kind', ...fields] },
    });
    const polymorphicWithSuper = (baseFields: readonly string[]) => ({
      Member: {
        collection: 'users',
        fields: ['_id', 'kind', ...baseFields],
        discriminator: 'kind',
        variants: { SuperMember: 'super' },
      },
      SuperMember: { collection: 'users', fields: [], base: 'Member' },
    });
    const collections = { users: { jsonSchema: sharedJsonSchema(['kind', 'level'], ['level']) } };
    const summaries = (result: ReturnType<typeof plan>) =>
      refusal(result).map(({ summary }) => summary);

    it('refuses to remove a variant field a plain root model declaring the discriminator field stores', () => {
      expect(
        summaries(
          plan({
            from: contract('from', models(['level'], plainWithKind(['level'])), collections),
            to: contract('to', models([], plainWithKind(['level'])), collections),
            schema,
          }),
        ),
      ).toEqual([
        'Cannot remove field "level" of model "SuperAdmin" from collection "users": model "User" stores it in the same collection',
      ]);
    });

    it('refuses to remove a variant field another variant with the same discriminator value inherits', () => {
      expect(
        summaries(
          plan({
            from: contract('from', models(['level'], polymorphicWithSuper(['level'])), collections),
            to: contract('to', models([], polymorphicWithSuper(['level'])), collections),
            schema,
          }),
        ),
      ).toEqual([
        'Cannot remove field "level" of model "SuperAdmin" from collection "users": model "Member", "SuperMember" stores it in the same collection',
      ]);
    });

    it('refuses to rename a variant field a plain root model declaring the discriminator field stores', () => {
      expect(
        summaries(
          plan({
            from: contract('from', models(['level'], plainWithKind(['level'])), collections),
            to: contract('to', models(['rank'], plainWithKind(['level'])), collections),
            schema,
            statements: [renameField('SuperAdmin', 'level', 'SuperAdmin', 'rank')],
          }),
        ),
      ).toEqual([
        'Cannot rename field "SuperAdmin.level" to "SuperAdmin.rank": model "User" stores field "level" in the same collection, "users"',
      ]);
    });

    it('compares discriminators by stored name, so a variant of another value is not reached', () => {
      const storedKind = (superFields: readonly string[]) =>
        ({
          Admin: {
            collection: 'users',
            fields: ['_id', 'kind'],
            storedAs: { kind: '_kind' },
            discriminator: 'kind',
            variants: { SuperAdmin: 'super' },
          },
          SuperAdmin: { collection: 'users', fields: superFields, base: 'Admin' },
          Member: {
            collection: 'users',
            fields: ['_id', 'kind'],
            storedAs: { kind: '_kind' },
            discriminator: 'kind',
            variants: { OtherMember: 'other' },
          },
          OtherMember: { collection: 'users', fields: ['level'], base: 'Member' },
        }) satisfies Record<string, ModelSpec>;
      expect(
        planned(
          plan({
            from: contract('from', storedKind(['level']), collections),
            to: contract('to', storedKind([]), collections),
            schema,
          }),
        ).dataLoss.map(({ subject }) => subject),
      ).toEqual([
        { kind: 'field', namespaceId: '__unbound__', model: 'SuperAdmin', field: 'level' },
      ]);
    });

    it('removes a variant field when no other model can hold the discriminator value', () => {
      expect(
        planned(
          plan({
            from: contract(
              'from',
              models(['level'], { User: { collection: 'users', fields: ['_id', 'level'] } }),
              collections,
            ),
            to: contract(
              'to',
              models([], { User: { collection: 'users', fields: ['_id', 'level'] } }),
              collections,
            ),
            schema,
          }),
        ).dataLoss.map(({ subject }) => subject),
      ).toEqual([
        { kind: 'field', namespaceId: '__unbound__', model: 'SuperAdmin', field: 'level' },
      ]);
    });
  });

  it('removes nothing without an origin contract when another root model still declares the field', () => {
    expect(planned(plan({ from: null, to: shared('to', [], ['level']), schema })).dataLoss).toEqual(
      [],
    );
  });
});
