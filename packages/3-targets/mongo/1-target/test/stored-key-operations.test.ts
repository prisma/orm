import { fieldRewriteOf } from '@internal/family-mongo/control';
import { MongoExistsExpr } from '@internal/mongo-query-ast/control';
import { RawAggregateCommand, RawUpdateManyCommand } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import {
  fillStoredKey,
  removeStoredKey,
  renameStoredKey,
} from '../src/core/migrations/migration-factories';
import {
  deserializeMongoOps,
  serializeMongoOps,
} from '../src/core/migrations/mongo-ops-serializer';
import {
  FillStoredKeyCall,
  RemoveStoredKeyCall,
  RenameStoredKeyCall,
} from '../src/core/migrations/op-factory-call';
import {
  documentsWithObject,
  type Expression,
  objectsRewritePipeline,
  storedKeyPath,
} from '../src/core/migrations/stored-key-path';

const holdsKey = (object: Expression, key: string) => ({
  $ne: [{ $type: { $getField: { field: { $literal: key }, input: object } } }, 'missing'],
});

const lacksKey = (object: Expression, key: string) => ({
  $in: [{ $type: { $getField: { field: { $literal: key }, input: object } } }, ['missing', 'null']],
});

const RAW_META = { target: 'mongo', storageHash: '', lane: 'mongo-raw' };

const streets = storedKeyPath('addresses', '$[*].street').assertOk();

function check(description: string, match: Record<string, unknown>) {
  return {
    description,
    source: {
      collection: 'users',
      command: new RawAggregateCommand('users', [{ $match: match }, { $limit: 1 }]),
      meta: RAW_META,
    },
    filter: MongoExistsExpr.exists('_id'),
    expect: 'notExists',
  };
}

function update(filter: Record<string, unknown>, pipeline: readonly Record<string, unknown>[]) {
  return {
    collection: 'users',
    command: new RawUpdateManyCommand('users', filter, pipeline, {
      bypassDocumentValidation: true,
    }),
    meta: RAW_META,
  };
}

const holdsStreet = documentsWithObject(streets, (object) => holdsKey(object, 'street'));

describe('renameStoredKey', () => {
  it('renames the key in every object at the path, checking first that none holds both keys', () => {
    const renamed = (object: Expression) => ({
      $cond: [
        holdsKey(object, 'street'),
        {
          $setField: {
            field: { $literal: 'line1' },
            input: { $unsetField: { field: { $literal: 'street' }, input: object } },
            value: { $getField: { field: { $literal: 'street' }, input: object } },
          },
        },
        object,
      ],
    });

    expect(
      renameStoredKey({
        collection: 'users',
        field: 'addresses',
        path: '$[*].street',
        to: 'line1',
      }),
    ).toEqual({
      id: 'storedKey.users.addresses.$[*].street.rename(line1)',
      meta: {
        rewrite: {
          kind: 'renameStoredKey',
          collection: 'users',
          field: 'addresses',
          path: '$[*].street',
          to: 'line1',
        },
      },
      label: 'Rename key "street" to "line1" at path "$[*]" in field addresses of collection users',
      operationClass: 'widening',
      name: 'storedKey.users.addresses.$[*].street.rename(line1)',
      precheck: [
        check(
          'no object at path "$[*]" in field addresses of collection users holds both key "street" and key "line1"; remove one of the two keys from those objects',
          documentsWithObject(streets, (object) => ({
            $and: [holdsKey(object, 'street'), holdsKey(object, 'line1')],
          })),
        ),
      ],
      run: [update(holdsStreet, objectsRewritePipeline(streets, renamed))],
      postcheck: [
        check(
          'no object at path "$[*]" in field addresses of collection users holds key "street"',
          holdsStreet,
        ),
      ],
    });
  });

  it('refuses to rename a key to its own name', () => {
    expect(() =>
      renameStoredKey({
        collection: 'users',
        field: 'addresses',
        path: '$[*].street',
        to: 'street',
      }),
    ).toThrow(
      'renameStoredKey renames key "street" at path "$[*]" in field addresses of collection users to its own name.',
    );
  });
});

describe('removeStoredKey', () => {
  it('removes the key from every object at the path that holds it, and checks none is left', () => {
    expect(
      removeStoredKey({ collection: 'users', field: 'addresses', path: '$[*].street' }),
    ).toEqual({
      id: 'storedKey.users.addresses.$[*].street.remove',
      meta: {
        rewrite: {
          kind: 'removeStoredKey',
          collection: 'users',
          field: 'addresses',
          path: '$[*].street',
        },
      },
      label: 'Remove key "street" at path "$[*]" in field addresses of collection users',
      operationClass: 'destructive',
      name: 'storedKey.users.addresses.$[*].street.remove',
      precheck: [],
      run: [
        update(
          holdsStreet,
          objectsRewritePipeline(streets, (object) => ({
            $unsetField: { field: { $literal: 'street' }, input: object },
          })),
        ),
      ],
      postcheck: [
        check(
          'no object at path "$[*]" in field addresses of collection users holds key "street"',
          holdsStreet,
        ),
      ],
    });
  });
});

describe('fillStoredKey', () => {
  it('sets the key where an object at the path lacks it or holds null, and checks none is left', () => {
    const lacksStreet = documentsWithObject(streets, (object) => lacksKey(object, 'street'));

    expect(
      fillStoredKey({
        collection: 'users',
        field: 'addresses',
        path: '$[*].street',
        value: { $literal: '' },
      }),
    ).toEqual({
      id: 'storedKey.users.addresses.$[*].street.fill',
      meta: {
        rewrite: {
          kind: 'fillStoredKey',
          collection: 'users',
          field: 'addresses',
          path: '$[*].street',
        },
      },
      label:
        'Fill key "street" at path "$[*]" in field addresses of collection users where it is missing or null',
      operationClass: 'widening',
      name: 'storedKey.users.addresses.$[*].street.fill',
      precheck: [],
      run: [
        update(
          lacksStreet,
          objectsRewritePipeline(streets, (object) => ({
            $cond: [
              lacksKey(object, 'street'),
              {
                $setField: {
                  field: { $literal: 'street' },
                  input: object,
                  value: { $literal: '' },
                },
              },
              object,
            ],
          })),
        ),
      ],
      postcheck: [
        check(
          'no object at path "$[*]" in field addresses of collection users lacks key "street" or holds null there',
          lacksStreet,
        ),
      ],
    });
  });
});

describe('a stored key operation with a filter', () => {
  it('rewrites only the documents the filter selects, and says which in its id and label', () => {
    const op = removeStoredKey({
      collection: 'users',
      field: 'addresses',
      path: '$[*].street',
      filter: { kind: 'admin' },
    });

    expect({
      id: op.id,
      label: op.label,
      filter: op.run[0]?.command,
      postcheck: op.postcheck[0]?.source.command,
    }).toMatchObject({
      id: 'storedKey.users.addresses.$[*].street.remove.where({"kind":"admin"})',
      label:
        'Remove key "street" at path "$[*]" in field addresses of collection users in documents whose kind is "admin"',
      filter: { filter: { $and: [{ kind: 'admin' }, holdsStreet] } },
      postcheck: {
        pipeline: [{ $match: { $and: [{ kind: 'admin' }, holdsStreet] } }, { $limit: 1 }],
      },
    });
  });
});

describe('stored key refusals', () => {
  const base = { collection: 'users', field: 'addresses' };

  it.each([
    ['a key containing "."', '$[*]["st.reet"]', 'MongoDB reads a name containing "." as a path'],
    [
      'a key starting with "$"',
      '$[*]["$street"]',
      'MongoDB reads a name starting with "$" as an operator',
    ],
    [
      'a path step containing "."',
      '$["a.b"].street',
      'MongoDB reads a name containing "." as a path',
    ],
  ])('refuses %s in the path', (_, path, reason) => {
    expect(() => removeStoredKey({ ...base, path })).toThrow(reason);
  });

  it('refuses a new name starting with "$"', () => {
    expect(() => renameStoredKey({ ...base, path: '$[*].street', to: '$line1' })).toThrow(
      'Key "$line1" at path "$[*]" in field addresses of collection users cannot be rewritten: MongoDB reads a name starting with "$" as an operator.',
    );
  });

  it('refuses a root field the field rewrites refuse', () => {
    expect(() => removeStoredKey({ ...base, field: '_id', path: '$.street' })).toThrow(
      'Field "_id" in collection users cannot be rewritten',
    );
  });

  it('refuses a path that is not a key path', () => {
    expect(() => fillStoredKey({ ...base, path: '$[0].street', value: 0 })).toThrow(
      'fillStoredKey cannot act at path "$[0].street" in field addresses of collection users: path "$[0].street" is not a JSONPath',
    );
  });
});

describe('stored key operations in ops.json', () => {
  const ops = [
    renameStoredKey({ collection: 'users', field: 'addresses', path: '$[*].street', to: 'line1' }),
    removeStoredKey({
      collection: 'users',
      field: 'addresses',
      path: '$[*].zip',
      filter: { kind: 'a' },
    }),
    fillStoredKey({
      collection: 'users',
      field: 'profile',
      path: '$.address.city',
      value: { $toLong: 0 },
    }),
  ];

  it('round-trip, and read as rewrites of their root field', () => {
    expect({
      roundTrip: deserializeMongoOps(JSON.parse(serializeMongoOps(ops)) as unknown[]),
      fields: ops.map((op) => fieldRewriteOf(op)?.field),
    }).toEqual({ roundTrip: ops, fields: ['addresses', 'addresses', 'profile'] });
  });
});

describe('stored key calls', () => {
  it('render the calls migration.ts writes, and lower to their factories', () => {
    const rename = new RenameStoredKeyCall({
      collection: 'users',
      field: 'addresses',
      path: '$[*].street',
      to: 'line1',
    });
    const remove = new RemoveStoredKeyCall({
      collection: 'users',
      field: 'addresses',
      path: '$[*].zip',
      filter: { kind: 'a' },
    });
    const fill = new FillStoredKeyCall({
      collection: 'users',
      field: 'addresses',
      path: '$[*].city',
      value: { $literal: '' },
    });
    const source = (call: { renderTypeScript(): string }) =>
      call
        .renderTypeScript()
        .replace(/\s+/g, '')
        .replace(/,(?=[\]}])/g, '');

    expect(
      [rename, remove, fill].map((call) => ({
        source: source(call),
        operationClass: call.operationClass,
        label: call.label,
        op: call.toOp(),
      })),
    ).toEqual([
      {
        source:
          'renameStoredKey({collection:"users",field:"addresses",path:"$[*].street",to:"line1"})',
        operationClass: 'widening',
        label: rename.toOp().label,
        op: renameStoredKey({
          collection: 'users',
          field: 'addresses',
          path: '$[*].street',
          to: 'line1',
        }),
      },
      {
        source:
          'removeStoredKey({collection:"users",field:"addresses",path:"$[*].zip",filter:{kind:"a"}})',
        operationClass: 'destructive',
        label: remove.toOp().label,
        op: removeStoredKey({
          collection: 'users',
          field: 'addresses',
          path: '$[*].zip',
          filter: { kind: 'a' },
        }),
      },
      {
        source:
          'fillStoredKey({collection:"users",field:"addresses",path:"$[*].city",value:{$literal:""}})',
        operationClass: 'widening',
        label: fill.toOp().label,
        op: fillStoredKey({
          collection: 'users',
          field: 'addresses',
          path: '$[*].city',
          value: { $literal: '' },
        }),
      },
    ]);
  });
});
