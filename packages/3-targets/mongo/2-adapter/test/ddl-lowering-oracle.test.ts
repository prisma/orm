import {
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
  RenameCollectionCommand,
} from '@internal/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import { createMongoAdapter } from '../src/mongo-adapter';

const adapter = createMongoAdapter();

async function lowerCmd(
  command:
    | CreateCollectionCommand
    | CreateIndexCommand
    | DropCollectionCommand
    | DropIndexCommand
    | RenameCollectionCommand
    | CollModCommand,
) {
  return adapter.lower({ command }, {});
}

describe('DDL lowering oracle — createCollection', () => {
  it('bare collection → kind + collection only', async () => {
    const wire = await lowerCmd(new CreateCollectionCommand('orders'));
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('orders');
    expect(wire).not.toHaveProperty('capped');
    expect(wire).not.toHaveProperty('validator');
  });

  it('capped + size + max', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('logs', { capped: true, size: 1048576, max: 1000 }),
    );
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('logs');
    expect(wire).toMatchObject({ capped: true, size: 1048576, max: 1000 });
  });

  it('validator + validationLevel + validationAction', async () => {
    const validator = { $jsonSchema: { bsonType: 'object', required: ['name'] } };
    const wire = await lowerCmd(
      new CreateCollectionCommand('docs', {
        validator,
        validationLevel: 'strict',
        validationAction: 'error',
      }),
    );
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('docs');
    expect(wire).toMatchObject({ validator, validationLevel: 'strict', validationAction: 'error' });
  });

  it('collation', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('items', { collation: { locale: 'en', strength: 2 } }),
    );
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('items');
    expect(wire).toMatchObject({ collation: { locale: 'en', strength: 2 } });
  });

  it('timeseries', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('readings', {
        timeseries: { timeField: 'ts', granularity: 'hours' },
      }),
    );
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('readings');
    expect(wire).toMatchObject({ timeseries: { timeField: 'ts', granularity: 'hours' } });
  });

  it('clusteredIndex', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('clustered', {
        clusteredIndex: { key: { _id: 1 }, unique: true, name: 'clustered_id' },
      }),
    );
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('clustered');
    expect(wire).toMatchObject({
      clusteredIndex: { key: { _id: 1 }, unique: true, name: 'clustered_id' },
    });
  });

  it('changeStreamPreAndPostImages', async () => {
    const wire = await lowerCmd(
      new CreateCollectionCommand('events', {
        changeStreamPreAndPostImages: { enabled: true },
      }),
    );
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('events');
    expect(wire).toMatchObject({ changeStreamPreAndPostImages: { enabled: true } });
  });

  it('omits undefined options', async () => {
    const wire = await lowerCmd(new CreateCollectionCommand('plain'));
    expect(wire.kind).toBe('createCollection');
    expect(wire.collection).toBe('plain');
    expect(wire).not.toHaveProperty('capped');
    expect(wire).not.toHaveProperty('validator');
    expect(wire).not.toHaveProperty('timeseries');
  });
});

describe('DDL lowering oracle — createIndex', () => {
  it('simple unique index', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
        unique: true,
        name: 'email_1',
      }),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('users');
    expect(wire).toMatchObject({ unique: true, name: 'email_1' });
  });

  it('sparse + expireAfterSeconds (TTL)', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('sessions', [{ field: 'createdAt', direction: 1 }], {
        sparse: true,
        expireAfterSeconds: 3600,
        name: 'createdAt_1',
      }),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('sessions');
    expect(wire).toMatchObject({ sparse: true, expireAfterSeconds: 3600, name: 'createdAt_1' });
  });

  it('partialFilterExpression', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('logs', [{ field: 'level', direction: 1 }], {
        partialFilterExpression: { active: true },
        name: 'level_1_partial',
      }),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('logs');
    expect(wire).toMatchObject({
      partialFilterExpression: { active: true },
      name: 'level_1_partial',
    });
  });

  it('wildcardProjection', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('products', [{ field: '$**', direction: 1 }], {
        wildcardProjection: { name: 1 },
        name: 'wildcard_1',
      }),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('products');
    expect(wire).toMatchObject({ wildcardProjection: { name: 1 }, name: 'wildcard_1' });
  });

  it('collation', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('items', [{ field: 'name', direction: 1 }], {
        collation: { locale: 'en', strength: 2 },
        name: 'name_1_en',
      }),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('items');
    expect(wire).toMatchObject({ collation: { locale: 'en', strength: 2 }, name: 'name_1_en' });
  });

  it('text index — weights, default_language, language_override', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand(
        'articles',
        [
          { field: 'title', direction: 'text' },
          { field: 'body', direction: 'text' },
        ],
        {
          weights: { title: 10, body: 1 },
          default_language: 'english',
          language_override: 'lang',
          name: 'articles_text',
        },
      ),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('articles');
    expect(wire).toMatchObject({
      weights: { title: 10, body: 1 },
      default_language: 'english',
      language_override: 'lang',
      name: 'articles_text',
    });
  });

  it('compound key', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand(
        'orders',
        [
          { field: 'userId', direction: 1 },
          { field: 'createdAt', direction: -1 },
        ],
        { name: 'userId_1_createdAt_-1' },
      ),
    );
    expect(wire.kind).toBe('createIndex');
    expect(wire.collection).toBe('orders');
    expect(wire).toMatchObject({ name: 'userId_1_createdAt_-1' });
  });

  it('omits undefined options', async () => {
    const wire = await lowerCmd(
      new CreateIndexCommand('bare', [{ field: 'x', direction: 1 }], { name: 'x_1' }),
    );
    expect(wire).not.toHaveProperty('unique');
    expect(wire).not.toHaveProperty('sparse');
    expect(wire).toMatchObject({ name: 'x_1' });
  });
});

describe('DDL lowering oracle — dropCollection', () => {
  it('produces {drop: collection}', async () => {
    const wire = await lowerCmd(new DropCollectionCommand('archive'));
    expect(wire.kind).toBe('dropCollection');
    expect(wire.collection).toBe('archive');
  });
});

describe('DDL lowering oracle — renameCollection', () => {
  it('produces the source collection and the new name', async () => {
    const wire = await lowerCmd(new RenameCollectionCommand('profiles', 'users'));
    expect({ ...wire }).toEqual({
      kind: 'renameCollection',
      collection: 'profiles',
      to: 'users',
    });
  });
});

describe('DDL lowering oracle — dropIndex', () => {
  it('produces {dropIndexes: collection, index: name}', async () => {
    const wire = await lowerCmd(new DropIndexCommand('users', 'email_1'));
    expect(wire.kind).toBe('dropIndex');
    expect(wire.collection).toBe('users');
    expect(wire).toMatchObject({ name: 'email_1' });
  });
});

describe('DDL lowering oracle — collMod', () => {
  it('bare collMod (no options) → kind + collection only', async () => {
    const wire = await lowerCmd(new CollModCommand('docs', {}));
    expect(wire.kind).toBe('collMod');
    expect(wire.collection).toBe('docs');
    expect(wire).not.toHaveProperty('validator');
    expect(wire).not.toHaveProperty('validationLevel');
  });

  it('validator + validationLevel + validationAction', async () => {
    const validator = { $jsonSchema: { bsonType: 'object' } };
    const wire = await lowerCmd(
      new CollModCommand('docs', {
        validator,
        validationLevel: 'moderate',
        validationAction: 'warn',
      }),
    );
    expect(wire.kind).toBe('collMod');
    expect(wire.collection).toBe('docs');
    expect(wire).toMatchObject({
      validator,
      validationLevel: 'moderate',
      validationAction: 'warn',
    });
  });

  it('changeStreamPreAndPostImages', async () => {
    const wire = await lowerCmd(
      new CollModCommand('events', { changeStreamPreAndPostImages: { enabled: true } }),
    );
    expect(wire.kind).toBe('collMod');
    expect(wire.collection).toBe('events');
    expect(wire).toMatchObject({ changeStreamPreAndPostImages: { enabled: true } });
  });
});
