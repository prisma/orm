import {
  buildIndexOpId,
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
  keysToKeySpec,
  ListCollectionsCommand,
  ListIndexesCommand,
  MongoAndExpr,
  MongoExistsExpr,
  MongoFieldFilter,
  MongoNotExpr,
  RenameCollectionCommand,
} from '@internal/mongo-query-ast/control';
import { MongoSchemaCollection, MongoSchemaCollectionOptions } from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import {
  collMod,
  createCollection,
  createIndex,
  dropCollection,
  dropIndex,
  renameCollection,
  setValidation,
  validatedCollection,
} from '../src/core/migrations/migration-factories';
import { schemaCollectionToCreateCollectionOptions } from '../src/core/migrations/op-factory-call';

const email = [{ field: 'email', direction: 1 as const }];

/** The filter `createIndex` and `dropIndex` match a plain or unique index on `email` by. */
function emailDefinition(unique: boolean) {
  return MongoAndExpr.of([
    MongoFieldFilter.eq('key', keysToKeySpec(email)),
    unique
      ? MongoFieldFilter.eq('unique', true)
      : new MongoNotExpr(MongoFieldFilter.eq('unique', true)),
    new MongoNotExpr(MongoFieldFilter.eq('sparse', true)),
    MongoExistsExpr.notExists('expireAfterSeconds'),
    MongoExistsExpr.notExists('partialFilterExpression'),
    MongoExistsExpr.notExists('wildcardProjection'),
    MongoExistsExpr.notExists('collation'),
  ]);
}

describe('createIndex', () => {
  it('creates the index under its name, checking that neither the name nor the content is taken', () => {
    expect(createIndex('users', email, { name: 'User_email_key', unique: true })).toEqual({
      id: 'index.users.create(User_email_key)',
      label: 'Create index User_email_key on users (email:1)',
      operationClass: 'additive',
      precheck: [
        {
          description: 'no index named User_email_key exists on users',
          source: new ListIndexesCommand('users'),
          filter: MongoFieldFilter.eq('name', 'User_email_key'),
          expect: 'notExists',
          object: 'an index named "User_email_key" in "users"',
        },
        {
          description: 'no index with the same keys and options exists on users',
          source: new ListIndexesCommand('users'),
          filter: emailDefinition(true),
          expect: 'notExists',
          object: 'an index on { email: 1 } in "users"',
        },
      ],
      execute: [
        {
          description: 'create index User_email_key on users',
          command: new CreateIndexCommand('users', email, {
            name: 'User_email_key',
            unique: true,
          }),
        },
      ],
      postcheck: [
        {
          description: 'index User_email_key exists on users',
          source: new ListIndexesCommand('users'),
          filter: MongoAndExpr.of([
            MongoFieldFilter.eq('name', 'User_email_key'),
            emailDefinition(true),
          ]),
          expect: 'exists',
        },
      ],
    });
  });

  it('names an index the call does not name as MongoDB would, as earlier migration files expect', () => {
    const op = createIndex('users', email, { unique: true });
    expect({
      id: op.id,
      name: (op.execute[0]!.command as CreateIndexCommand).name,
    }).toEqual({ id: 'index.users.create(email_1)', name: 'email_1' });
  });

  it('gives two indexes on the same keys with different options their own ids', () => {
    expect([
      createIndex('users', email, { name: 'User_email_key', unique: true }).id,
      createIndex('users', email, { name: 'User_email_idx' }).id,
    ]).toEqual(['index.users.create(User_email_key)', 'index.users.create(User_email_idx)']);
  });

  it('passes through all index options', () => {
    const op = createIndex('users', email, {
      name: 'by_email',
      sparse: true,
      expireAfterSeconds: 3600,
      collation: { locale: 'en' },
    });

    const cmd = op.execute[0]!.command as CreateIndexCommand;
    expect(cmd).toEqual(
      new CreateIndexCommand('users', email, {
        name: 'by_email',
        sparse: true,
        expireAfterSeconds: 3600,
        collation: { locale: 'en' },
      }),
    );
  });

  it('checks a text index by its MongoDB key spec', () => {
    const textKeys = [{ field: 'content', direction: 'text' as const }];
    const contentCheck = createIndex('posts', textKeys, { name: 'content_text' }).precheck[1]!;

    expect(contentCheck.object).toBe('a text index in "posts"');
    expect((contentCheck.filter as MongoAndExpr).exprs[0]).toEqual(
      MongoFieldFilter.eq('key', { _fts: 'text', _ftsx: 1 }),
    );
  });

  it('labels compound keys', () => {
    const compoundKeys = [
      { field: 'email', direction: 1 as const },
      { field: 'name', direction: -1 as const },
    ];
    const op = createIndex('users', compoundKeys, { name: 'email_1_name_-1' });

    expect(op.label).toBe('Create index email_1_name_-1 on users (email:1, name:-1)');
    expect(op.id).toBe(buildIndexOpId('create', 'users', 'email_1_name_-1'));
  });
});

describe('dropIndex', () => {
  it('drops the index by its name, checking its name and content first and its name after', () => {
    expect(dropIndex('users', email, { name: 'User_email_key', unique: true })).toEqual({
      id: 'index.users.drop(User_email_key)',
      label: 'Drop index User_email_key on users (email:1)',
      operationClass: 'widening',
      precheck: [
        {
          description: 'index User_email_key exists on users with the expected keys and options',
          source: new ListIndexesCommand('users'),
          filter: MongoAndExpr.of([
            MongoFieldFilter.eq('name', 'User_email_key'),
            emailDefinition(true),
          ]),
          expect: 'exists',
          object: 'an index named "User_email_key" in "users"',
        },
      ],
      execute: [
        {
          description: 'drop index User_email_key on users',
          command: new DropIndexCommand('users', 'User_email_key'),
        },
      ],
      postcheck: [
        {
          description: 'index User_email_key no longer exists on users',
          source: new ListIndexesCommand('users'),
          filter: MongoFieldFilter.eq('name', 'User_email_key'),
          expect: 'notExists',
          object: 'an index named "User_email_key" in "users"',
        },
      ],
    });
  });

  it('drops the index named after its keys and checks its keys only when the call gives no options, as earlier migration files expect', () => {
    const op = dropIndex('users', email);
    expect({
      id: op.id,
      name: (op.execute[0]!.command as DropIndexCommand).name,
      precheck: op.precheck[0]?.filter,
    }).toEqual({
      id: 'index.users.drop(email_1)',
      name: 'email_1',
      precheck: MongoAndExpr.of([
        MongoFieldFilter.eq('name', 'email_1'),
        MongoFieldFilter.eq('key', keysToKeySpec(email)),
      ]),
    });
  });

  it('checks a text index by its text key when the call gives no options', () => {
    const textKeys = [{ field: 'content', direction: 'text' as const }];
    const op = dropIndex('posts', textKeys);

    expect(op.precheck[0]?.filter).toEqual(
      MongoAndExpr.of([
        MongoFieldFilter.eq('name', 'content_text'),
        MongoFieldFilter.eq('key._fts', 'text'),
      ]),
    );
  });
});

describe('renameCollection', () => {
  it('renames when the source exists and the target does not, and skips once the target exists without the source', () => {
    const sourceIs = (expect: 'exists' | 'notExists') => ({
      description: 'collection profiles exists',
      source: new ListCollectionsCommand(),
      filter: MongoFieldFilter.eq('name', 'profiles'),
      expect,
      object: 'collection "profiles"',
    });
    const targetIs = (expect: 'exists' | 'notExists') => ({
      description: 'collection users exists',
      source: new ListCollectionsCommand(),
      filter: MongoFieldFilter.eq('name', 'users'),
      expect,
      object: 'collection "users"',
    });

    expect(renameCollection('profiles', 'users')).toEqual({
      id: 'collection.profiles.rename(users)',
      label: 'Rename collection profiles to users',
      operationClass: 'widening',
      precheck: [
        sourceIs('exists'),
        { ...targetIs('notExists'), description: 'collection users does not exist' },
      ],
      execute: [
        {
          description: 'rename collection profiles to users',
          command: new RenameCollectionCommand('profiles', 'users'),
        },
      ],
      postcheck: [
        targetIs('exists'),
        { ...sourceIs('notExists'), description: 'collection profiles does not exist' },
      ],
    });
  });
});

describe('createCollection', () => {
  it('produces correct operation structure', () => {
    const op = createCollection('users');

    expect(op.id).toBe('collection.users.create');
    expect(op.label).toBe('Create collection users');
    expect(op.operationClass).toBe('additive');
  });

  it('includes precheck that collection does not exist', () => {
    const op = createCollection('users');

    expect(op.precheck).toHaveLength(1);
    expect(op.precheck[0]!.expect).toBe('notExists');
    expect(op.precheck[0]!.source).toBeInstanceOf(ListCollectionsCommand);
    const filter = op.precheck[0]!.filter as MongoFieldFilter;
    expect(filter.field).toBe('name');
    expect(filter.value).toBe('users');
  });

  it('includes execute with CreateCollectionCommand', () => {
    const op = createCollection('users');

    const cmd = op.execute[0]!.command as CreateCollectionCommand;
    expect(cmd).toBeInstanceOf(CreateCollectionCommand);
    expect(cmd.collection).toBe('users');
  });

  it('passes through validator options', () => {
    const op = createCollection('users', {
      validator: { $jsonSchema: { required: ['email'] } },
      validationLevel: 'strict',
      validationAction: 'error',
    });

    const cmd = op.execute[0]!.command as CreateCollectionCommand;
    expect(cmd.validator).toEqual({ $jsonSchema: { required: ['email'] } });
    expect(cmd.validationLevel).toBe('strict');
    expect(cmd.validationAction).toBe('error');
  });

  it('passes through capped options', () => {
    const op = createCollection('logs', {
      capped: true,
      size: 1000000,
      max: 5000,
    });

    const cmd = op.execute[0]!.command as CreateCollectionCommand;
    expect(cmd.capped).toBe(true);
    expect(cmd.size).toBe(1000000);
    expect(cmd.max).toBe(5000);
  });

  it('passes through timeseries options', () => {
    const op = createCollection('metrics', {
      timeseries: { timeField: 'timestamp', metaField: 'source', granularity: 'minutes' },
    });

    const cmd = op.execute[0]!.command as CreateCollectionCommand;
    expect(cmd.timeseries).toEqual({
      timeField: 'timestamp',
      metaField: 'source',
      granularity: 'minutes',
    });
  });

  it('passes through collation and clusteredIndex', () => {
    const op = createCollection('users', {
      collation: { locale: 'en', strength: 2 },
      clusteredIndex: { key: { _id: 1 }, unique: true },
    });

    const cmd = op.execute[0]!.command as CreateCollectionCommand;
    expect(cmd.collation).toEqual({ locale: 'en', strength: 2 });
    expect(cmd.clusteredIndex).toEqual({ key: { _id: 1 }, unique: true });
  });

  it('passes through changeStreamPreAndPostImages', () => {
    const op = createCollection('events', {
      changeStreamPreAndPostImages: { enabled: true },
    });

    const cmd = op.execute[0]!.command as CreateCollectionCommand;
    expect(cmd.changeStreamPreAndPostImages).toEqual({ enabled: true });
  });

  it('has empty postcheck', () => {
    const op = createCollection('users');
    expect(op.postcheck).toHaveLength(0);
  });
});

describe('dropCollection', () => {
  it('produces correct operation structure', () => {
    const op = dropCollection('users');

    expect(op.id).toBe('collection.users.drop');
    expect(op.label).toBe('Drop collection users');
    expect(op.operationClass).toBe('destructive');
  });

  it('includes execute with DropCollectionCommand', () => {
    const op = dropCollection('users');

    const cmd = op.execute[0]!.command as DropCollectionCommand;
    expect(cmd).toBeInstanceOf(DropCollectionCommand);
    expect(cmd.collection).toBe('users');
  });

  it('has empty precheck and postcheck', () => {
    const op = dropCollection('users');
    expect(op.precheck).toHaveLength(0);
    expect(op.postcheck).toHaveLength(0);
  });
});

describe('setValidation', () => {
  it('produces correct operation structure', () => {
    const op = setValidation('users', { required: ['email'] });

    expect(op.id).toBe('collection.users.setValidation');
    expect(op.label).toBe('Set validation on users');
    expect(op.operationClass).toBe('widening');
  });

  it('wraps schema in $jsonSchema validator', () => {
    const schema = { required: ['email'], properties: { email: { bsonType: 'string' } } };
    const op = setValidation('users', schema);

    const cmd = op.execute[0]!.command as CollModCommand;
    expect(cmd).toBeInstanceOf(CollModCommand);
    expect(cmd.collection).toBe('users');
    expect(cmd.validator).toEqual({ $jsonSchema: schema });
  });

  it('passes through validationLevel and validationAction', () => {
    const op = setValidation(
      'users',
      { required: ['email'] },
      {
        validationLevel: 'moderate',
        validationAction: 'warn',
      },
    );

    const cmd = op.execute[0]!.command as CollModCommand;
    expect(cmd.validationLevel).toBe('moderate');
    expect(cmd.validationAction).toBe('warn');
  });

  it('has empty precheck and postcheck', () => {
    const op = setValidation('users', { required: ['email'] });
    expect(op.precheck).toHaveLength(0);
    expect(op.postcheck).toHaveLength(0);
  });

  it('round-trips through JSON', () => {
    const op = setValidation('users', { required: ['email'] }, { validationLevel: 'strict' });
    const json = JSON.parse(JSON.stringify(op));

    expect(json.execute[0].command.kind).toBe('collMod');
    expect(json.execute[0].command.validator).toEqual({
      $jsonSchema: { required: ['email'] },
    });
  });
});

describe('validatedCollection', () => {
  it('creates collection with schema validation', () => {
    const ops = validatedCollection('users', { required: ['email'] }, []);

    expect(ops).toHaveLength(1);
    expect(ops[0]!.id).toBe('collection.users.create');

    const cmd = ops[0]!.execute[0]!.command as CreateCollectionCommand;
    expect(cmd.validator).toEqual({ $jsonSchema: { required: ['email'] } });
    expect(cmd.validationLevel).toBe('strict');
    expect(cmd.validationAction).toBe('error');
  });

  it('includes indexes after collection creation', () => {
    const ops = validatedCollection('users', { required: ['email'] }, [
      { keys: [{ field: 'email', direction: 1 }], unique: true },
      { keys: [{ field: 'name', direction: 1 }] },
    ]);

    expect(ops).toHaveLength(3);
    expect(ops[0]!.id).toBe('collection.users.create');

    const idx1 = ops[1]!.execute[0]!.command as CreateIndexCommand;
    expect(idx1.collection).toBe('users');
    expect(idx1.unique).toBe(true);

    const idx2 = ops[2]!.execute[0]!.command as CreateIndexCommand;
    expect(idx2.collection).toBe('users');
    expect(idx2.unique).toBeUndefined();
  });

  it('returns flat array of operations', () => {
    const ops = validatedCollection('users', { required: ['email'] }, [
      { keys: [{ field: 'email', direction: 1 }] },
    ]);

    expect(Array.isArray(ops)).toBe(true);
    expect(ops.every((op) => 'id' in op && 'execute' in op)).toBe(true);
  });
});

describe('collMod', () => {
  it('produces correct default operation structure', () => {
    const op = collMod('users', {
      validator: { $jsonSchema: { required: ['email'] } },
      validationLevel: 'strict',
      validationAction: 'error',
    });

    expect(op.id).toBe('collection.users.collMod');
    expect(op.label).toBe('Modify collection users');
    expect(op.operationClass).toBe('widening');
  });

  it('applies meta overrides for id, label, and operationClass', () => {
    const op = collMod(
      'users',
      { validator: { $jsonSchema: { required: ['email'] } } },
      {
        id: 'validator.users.add',
        label: 'Add validator on users',
        operationClass: 'widening',
      },
    );

    expect(op.id).toBe('validator.users.add');
    expect(op.label).toBe('Add validator on users');
    expect(op.operationClass).toBe('widening');
  });

  it('includes collection-exists precheck when validator is present', () => {
    const op = collMod('users', {
      validator: { $jsonSchema: { required: ['email'] } },
    });

    expect(op.precheck).toHaveLength(1);
    expect(op.precheck[0]!.expect).toBe('exists');
    expect(op.precheck[0]!.source).toBeInstanceOf(ListCollectionsCommand);
    const filter = op.precheck[0]!.filter as MongoFieldFilter;
    expect(filter.field).toBe('name');
    expect(filter.value).toBe('users');
  });

  it('includes collection-exists precheck when validator is empty (removal)', () => {
    const op = collMod('users', {
      validator: {},
      validationLevel: 'strict',
      validationAction: 'error',
    });

    expect(op.precheck).toHaveLength(1);
    expect(op.precheck[0]!.expect).toBe('exists');
  });

  it('has no precheck when only changeStreamPreAndPostImages is set', () => {
    const op = collMod('users', {
      changeStreamPreAndPostImages: { enabled: true },
    });

    expect(op.precheck).toHaveLength(0);
  });

  it('includes postcheck when validator has content', () => {
    const op = collMod('users', {
      validator: { $jsonSchema: { required: ['email'] } },
      validationLevel: 'strict',
      validationAction: 'error',
    });

    expect(op.postcheck).toHaveLength(1);
    expect(op.postcheck[0]!.expect).toBe('exists');
  });

  it('includes $jsonSchema body in postcheck filter to prevent spurious idempotency skip', () => {
    const schema = {
      bsonType: 'object',
      required: ['email'],
      properties: { email: { bsonType: 'string' } },
    };
    const op = collMod('users', {
      validator: { $jsonSchema: schema },
      validationLevel: 'strict',
      validationAction: 'error',
    });

    expect(op.postcheck).toHaveLength(1);
    const postcheckFilter = op.postcheck[0]!.filter as MongoAndExpr;
    expect(postcheckFilter).toBeInstanceOf(MongoAndExpr);
    // Must contain: name + validationLevel + validationAction + $jsonSchema body
    expect(postcheckFilter.exprs).toHaveLength(4);
    const schemaFilter = postcheckFilter.exprs[3] as MongoFieldFilter;
    expect(schemaFilter).toBeInstanceOf(MongoFieldFilter);
    expect(schemaFilter.field).toBe('options.validator.$jsonSchema');
    expect(schemaFilter.value).toEqual(schema);
  });

  it('has no postcheck when validator is empty (removal)', () => {
    const op = collMod('users', {
      validator: {},
      validationLevel: 'strict',
      validationAction: 'error',
    });

    expect(op.postcheck).toHaveLength(0);
  });

  it('has no postcheck when only changeStreamPreAndPostImages is set', () => {
    const op = collMod('users', {
      changeStreamPreAndPostImages: { enabled: true },
    });

    expect(op.postcheck).toHaveLength(0);
  });

  it('uses CollModCommand in execute', () => {
    const op = collMod('users', {
      validator: { $jsonSchema: { required: ['email'] } },
      validationLevel: 'strict',
      validationAction: 'error',
    });

    expect(op.execute).toHaveLength(1);
    const cmd = op.execute[0]!.command as CollModCommand;
    expect(cmd).toBeInstanceOf(CollModCommand);
    expect(cmd.collection).toBe('users');
    expect(cmd.validator).toEqual({ $jsonSchema: { required: ['email'] } });
    expect(cmd.validationLevel).toBe('strict');
    expect(cmd.validationAction).toBe('error');
  });
});

describe('serialization round-trip', () => {
  it('createIndex round-trips through JSON', () => {
    const op = createIndex('users', [{ field: 'email', direction: 1 }], { unique: true });
    const json = JSON.parse(JSON.stringify(op));

    expect(json.id).toBe(op.id);
    expect(json.label).toBe(op.label);
    expect(json.operationClass).toBe(op.operationClass);
    expect(json.precheck).toHaveLength(2);
    expect(json.execute).toHaveLength(1);
    expect(json.postcheck).toHaveLength(1);
    expect(json.execute[0].command.kind).toBe('createIndex');
  });

  it('dropIndex round-trips through JSON', () => {
    const op = dropIndex('users', [{ field: 'email', direction: 1 }]);
    const json = JSON.parse(JSON.stringify(op));

    expect(json.execute[0].command.kind).toBe('dropIndex');
    expect(json.precheck[0].source.kind).toBe('listIndexes');
  });

  it('createCollection round-trips through JSON', () => {
    const op = createCollection('users', {
      validator: { $jsonSchema: { required: ['email'] } },
      validationLevel: 'strict',
    });
    const json = JSON.parse(JSON.stringify(op));

    expect(json.execute[0].command.kind).toBe('createCollection');
    expect(json.execute[0].command.validator).toEqual({ $jsonSchema: { required: ['email'] } });
  });

  it('dropCollection round-trips through JSON', () => {
    const op = dropCollection('users');
    const json = JSON.parse(JSON.stringify(op));

    expect(json.execute[0].command.kind).toBe('dropCollection');
  });
});

describe('schemaCollectionToCreateCollectionOptions', () => {
  it('returns undefined for collection with no options and no validator', () => {
    const coll = new MongoSchemaCollection({ name: 'bare' });
    expect(schemaCollectionToCreateCollectionOptions(coll)).toBeUndefined();
  });

  it('maps clusteredIndex option with name', () => {
    const coll = new MongoSchemaCollection({
      name: 'clustered',
      options: new MongoSchemaCollectionOptions({
        clusteredIndex: { name: 'my_cluster' },
      }),
    });
    const result = schemaCollectionToCreateCollectionOptions(coll);
    expect(result).toBeDefined();
    expect(result!.clusteredIndex).toEqual({
      key: { _id: 1 },
      unique: true,
      name: 'my_cluster',
    });
  });

  it('maps clusteredIndex without explicit name', () => {
    const coll = new MongoSchemaCollection({
      name: 'clustered',
      options: new MongoSchemaCollectionOptions({
        clusteredIndex: {},
      }),
    });
    const result = schemaCollectionToCreateCollectionOptions(coll);
    expect(result).toBeDefined();
    expect(result!.clusteredIndex).toEqual({
      key: { _id: 1 },
      unique: true,
    });
  });
});
