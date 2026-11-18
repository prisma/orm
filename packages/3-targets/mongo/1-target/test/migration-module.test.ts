import { describe, expect, it } from 'vitest';
import { MongoMigrationPlanner } from '../src/core/migrations/mongo-planner';
import * as opFactoryCalls from '../src/core/migrations/op-factory-call';
import {
  CastFieldCall,
  CollModCall,
  CreateCollectionCall,
  CreateIndexCall,
  DataTransformCall,
  DeleteDocumentsCall,
  DropCollectionCall,
  DropIndexCall,
  FillFieldCall,
  FillStoredKeyCall,
  RemoveStoredKeyCall,
  RemoveStoredValueCall,
  RenameCollectionCall,
  RenameFieldCall,
  RenameStoredKeyCall,
  ReplaceStoredValueCall,
  UnsetFieldCall,
} from '../src/core/migrations/op-factory-call';
import { renderCallsToTypeScript } from '../src/core/migrations/render-typescript';
import { UnfilledValue } from '../src/core/migrations/unfilled-value';

const MODULE = '@acme/orm-db/migration';
const FROM_HASH = 'a'.repeat(64);
const TO_HASH = 'b'.repeat(64);

function packageImports(source: string): string[] {
  return [...source.matchAll(/from '([^']+)'/g)]
    .map(([, module]) => module ?? '')
    .filter((module) => !module.startsWith('.'));
}

describe('the module a rendered MongoDB migration imports from', () => {
  it('is the module the config names, for every package import of a planned migration', () => {
    const source = renderCallsToTypeScript([new DropCollectionCall('stale')], {
      from: FROM_HASH,
      to: TO_HASH,
      snapshotsImportPath: '../../snapshots',
      migrationModule: MODULE,
    });

    expect(packageImports(source)).toEqual([MODULE]);
  });

  it('is the module the config names when the migration holds every kind of operation, the stored key and value rewrites included', () => {
    const index = [{ field: 'email', direction: 1 as const }];
    const calls = [
      new CreateCollectionCall('users'),
      new DropCollectionCall('stale'),
      new RenameCollectionCall('profiles', 'users'),
      new CreateIndexCall('users', index, { name: 'email_1', unique: true }),
      new DropIndexCall('users', index, { name: 'email_1' }),
      new CollModCall('users', { validationLevel: 'strict' }),
      new RenameFieldCall('users', 'name', 'fullName'),
      new UnsetFieldCall('users', 'nickname'),
      new CastFieldCall({ collection: 'users', field: 'age', from: ['string'], to: 'int' }),
      new FillFieldCall({ collection: 'users', field: 'age', value: { $toLong: 0 } }),
      new DataTransformCall('User.age', 'users', { age: { $type: 'string' } }),
      new RenameStoredKeyCall({
        collection: 'users',
        field: 'addresses',
        path: '$[*].street',
        to: 'line1',
      }),
      new RemoveStoredKeyCall({ collection: 'users', field: 'addresses', path: '$[*].zip' }),
      new FillStoredKeyCall({
        collection: 'users',
        field: 'addresses',
        path: '$[*].city',
        value: new UnfilledValue('the city of each address'),
      }),
      new ReplaceStoredValueCall({
        collection: 'tasks',
        field: 'type',
        from: 'issue',
        to: { $literal: 'bug' },
      }),
      new RemoveStoredValueCall(
        { collection: 'tasks', field: 'type', value: 'legacy' },
        { importsReplacement: true },
      ),
      new DeleteDocumentsCall({ collection: 'tasks', filter: { type: 'legacy' } }),
    ];
    const source = renderCallsToTypeScript(calls, {
      from: FROM_HASH,
      to: TO_HASH,
      snapshotsImportPath: '../../snapshots',
      migrationModule: MODULE,
    });

    const callClasses = Object.entries(opFactoryCalls)
      .filter(([name, value]) => typeof value === 'function' && name.endsWith('Call'))
      .map(([name]) => name)
      .sort();
    expect(calls.map((call) => call.constructor.name).sort()).toEqual(callClasses);
    expect(source).toMatch(/\bplaceholder\b/);
    expect(source).toMatch(/\breplaceStoredValue\b/);
    expect(packageImports(source)).toEqual([MODULE]);
  });

  it('is the module the config names for the empty migration `migration new` writes', () => {
    const source = new MongoMigrationPlanner()
      .emptyMigration({
        packageDir: '/p',
        fromHash: FROM_HASH,
        toHash: TO_HASH,
        snapshotsImportPath: '../../snapshots',
      })
      .renderTypeScript(MODULE);

    expect(packageImports(source)).toEqual([MODULE]);
  });
});
