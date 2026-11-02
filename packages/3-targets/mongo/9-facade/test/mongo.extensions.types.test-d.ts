import type { MongoRuntimeExtensionDescriptor } from '@internal/mongo-runtime';
import { test } from 'vitest';
import type { Contract } from '../../../../2-mongo-family/1-foundation/mongo-contract/test/fixtures/orm-contract';
import mongo from '../src/runtime/mongo';
import mongoStatic from '../src/static/mongo-static';

declare const contract: Contract;
declare const pack: MongoRuntimeExtensionDescriptor<'mongo'>;

const sqlPack = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  codecs: () => [],
  create: () => ({ familyId: 'sql', targetId: 'postgres' }),
} as const;

test('mongo() takes MongoDB extension descriptors', () => {
  mongo({ contract, url: 'mongodb://localhost/db', extensions: [pack] });
});

test('mongoStatic() takes MongoDB extension descriptors', () => {
  mongoStatic({ contract, extensions: [pack] });
});

test('mongo() refuses a SQL extension descriptor', () => {
  // @ts-expect-error a SQL extension descriptor is not a MongoDB one
  mongo({ contract, url: 'mongodb://localhost/db', extensions: [sqlPack] });
});

test('mongoStatic() refuses a SQL extension descriptor', () => {
  // @ts-expect-error a SQL extension descriptor is not a MongoDB one
  mongoStatic({ contract, extensions: [sqlPack] });
});
