import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const APP_NOTE =
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.22-to-8.0.0-rc.23/instructions.md';
const EXTENSION_NOTE =
  'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.22-to-8.0.0-rc.23/instructions.md';

const matcher = (path: string, id: string) => (content: string) =>
  detectionPatterns(path, id).some((pattern) => pattern.test(content));

describe('the app mongo-contracts-record-index-names detection', () => {
  const matches = matcher(APP_NOTE, 'mongo-contracts-record-index-names');

  it('matches a contract index without a name, compact or pretty, and not one with a name', () => {
    expect([
      matches('{"keys":[{"direction":1,"field":"a"}],"kind":"mongo-index"}'),
      matches('{"keys":[{"direction":1,"field":"a"}],"kind":"mongo-index","unique":true}'),
      matches('{\n  "kind": "mongo-index",\n  "unique": true\n}'),
      matches('{"keys":[],"kind":"mongo-index","name":"a_1"}'),
      matches('{\n  "kind": "mongo-index",\n  "name": "a_1"\n}'),
      matches('{"kind":"mongo-collection"}'),
    ]).toEqual([true, true, true, false, false, false]);
  });
});

describe('the app mongo-unnamed-indexes-with-one-name-refused detection', () => {
  const matches = matcher(APP_NOTE, 'mongo-unnamed-indexes-with-one-name-refused');

  it('matches a variant with an index and a TypeScript index with options that tell indexes apart', () => {
    expect([
      matches('model Bug {\n  title String\n  @@base(Task, "bug")\n  @@index([title])\n}\n'),
      matches('index({ email: 1 }, { sparse: true })'),
      matches('index({ email: 1 }, { unique: true })'),
      matches('model User {\n  email String\n  @@index([email])\n}\n'),
    ]).toEqual([true, true, false, false]);
  });
});

describe('the app mongo-prisma6-index-names detection', () => {
  const matches = matcher(APP_NOTE, 'mongo-prisma6-index-names');
  const prisma6Model = (body: string) =>
    `model User {\n  id    String @id @default(auto()) @map("_id") @db.ObjectId\n${body}\n}\n`;

  it('matches a Prisma 6 MongoDB schema with an index, and not other schemas', () => {
    expect([
      matches(prisma6Model('  email String @unique')),
      matches(prisma6Model('  email String\n\n  @@fulltext([email])')),
      matches(prisma6Model('  email String')),
      matches('model User {\n  id    ObjectId @id @map("_id")\n  email String @unique\n}\n'),
    ]).toEqual([true, true, false, false]);
  });
});

describe('the app mongo-index-operations-by-name detection', () => {
  const matches = matcher(APP_NOTE, 'mongo-index-operations-by-name');

  it('matches an operation id built from keys, and not one built from a name', () => {
    expect([
      matches("expect(op.id).toBe('index.users.create(email:1)');"),
      matches('"id": "index.posts.drop(createdAt:-1,authorId:1)"'),
      matches("expect(op.id).toBe('index.users.create(email_1)');"),
      matches("createIndex('users', keys, { name: 'email_1' })"),
    ]).toEqual([true, true, false, false]);
  });
});

describe('the extension mongo-index-name-required detection', () => {
  const matches = matcher(EXTENSION_NOTE, 'mongo-index-name-required');

  it('matches index construction and the moved helpers, and not unrelated index code', () => {
    expect([
      matches("new MongoIndex({ keys: [{ field: 'a', direction: 1 }] })"),
      matches('new MongoSchemaIndex({ keys })'),
      matches('const input: MongoIndexInput = { keys };'),
      matches(
        "import { defaultMongoIndexName } from '@prisma/orm-family-mongo/query-ast/control';",
      ),
      matches("buildIndexOpId('create', 'users', keys)"),
      matches('const lookup = indexLookupKey(index);'),
      matches('new MongoIndexOptions({ unique: true })'),
    ]).toEqual([true, true, true, true, true, false, false]);
  });
});

describe('the extension mongo-index-calls-take-name detection', () => {
  const matches = matcher(EXTENSION_NOTE, 'mongo-index-calls-take-name');

  it('matches index call construction, and not other calls', () => {
    expect([
      matches("new CreateIndexCall('users', keys, { unique: true })"),
      matches("new DropIndexCall('users', keys)"),
      matches('schemaIndexToCreateIndexOptions(index)'),
      matches("new CreateCollectionCall('users')"),
    ]).toEqual([true, true, true, false]);
  });
});

describe('the extension mongo-build-refusal-index-name-duplicate detection', () => {
  const matches = matcher(EXTENSION_NOTE, 'mongo-build-refusal-index-name-duplicate');

  it('matches code that reads builder refusals or builds a definition, and not defineContract', () => {
    expect([
      matches(
        "import type { BuildRefusal } from '@prisma/orm-family-mongo/contract-ts/contract-builder';",
      ),
      matches('buildMongoContractFromDefinition(definition, codecLookup, dataTypes)'),
      matches('mergeRedundantIndexes(definition, codecLookup, dataTypes)'),
      matches('export const contract = defineContract({ models });'),
    ]).toEqual([true, true, true, false]);
  });
});
