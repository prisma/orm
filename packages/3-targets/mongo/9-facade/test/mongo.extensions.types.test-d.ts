import type { MongoRuntimeExtensionDescriptor } from '@internal/mongo-runtime';
import { test } from 'vitest';
import type { Contract } from '../../../../2-mongo-family/1-foundation/mongo-contract/test/fixtures/orm-contract';
import mongo from '../src/runtime/mongo';
import mongoStatic from '../src/static/mongo-static';

declare const contract: Contract;
declare const pack: MongoRuntimeExtensionDescriptor<'mongo'>;

function extensionOfFamily<const Family extends string>(familyId: Family) {
  return {
    kind: 'extension',
    id: 'shout',
    familyId,
    targetId: 'mongo',
    version: '0.0.1',
    create: () => ({ familyId, targetId: 'mongo' as const }),
  } as const;
}

const mongoFamilyPack = extensionOfFamily('mongo');
const sqlFamilyPack = extensionOfFamily('sql');

test('mongo() takes MongoDB extension descriptors', () => {
  mongo({ contract, url: 'mongodb://localhost/db', extensions: [pack] });
  mongo({ contract, url: 'mongodb://localhost/db', extensions: [mongoFamilyPack] });
});

test('mongoStatic() takes MongoDB extension descriptors', () => {
  mongoStatic({ contract, extensions: [pack] });
  mongoStatic({ contract, extensions: [mongoFamilyPack] });
});

test('mongo() refuses the same descriptor of another family', () => {
  // @ts-expect-error a SQL extension descriptor is not a MongoDB one
  mongo({ contract, url: 'mongodb://localhost/db', extensions: [sqlFamilyPack] });
});

test('mongoStatic() refuses the same descriptor of another family', () => {
  // @ts-expect-error a SQL extension descriptor is not a MongoDB one
  mongoStatic({ contract, extensions: [sqlFamilyPack] });
});
