import { fieldRewriteOf } from '@internal/family-mongo/control';
import { describe, expect, it } from 'vitest';
import { removeStoredValue, replaceStoredValue } from '../src/core/migrations/migration-factories';
import {
  deserializeMongoOps,
  serializeMongoOps,
} from '../src/core/migrations/mongo-ops-serializer';
import {
  RemoveStoredValueCall,
  ReplaceStoredValueCall,
} from '../src/core/migrations/op-factory-call';

function summary(op: ReturnType<typeof replaceStoredValue>) {
  return {
    id: op.id,
    name: op.name,
    label: op.label,
    operationClass: op.operationClass,
    meta: op.meta,
    precheck: op.precheck.map((check) => check.description),
    postcheck: op.postcheck.map((check) => check.description),
    runs: op.run.length,
  };
}

describe('replaceStoredValue', () => {
  it('replaces the value in a root field, and checks no document still holds it', () => {
    expect(
      summary(
        replaceStoredValue({
          collection: 'users',
          field: 'status',
          from: 'active',
          to: { $literal: 'enabled' },
        }),
      ),
    ).toEqual({
      id: 'storedValue.users.status.replace("active")',
      name: 'storedValue.users.status.replace("active")',
      label: 'Replace value "active" with "enabled" in field status of collection users',
      operationClass: 'widening',
      meta: { rewrite: { kind: 'replaceStoredValue', collection: 'users', field: 'status' } },
      precheck: [],
      postcheck: ['no document in users holds value "active" in field status'],
      runs: 1,
    });
  });

  it('replaces the value at a path inside the field, and names the path', () => {
    expect(
      summary(
        replaceStoredValue({
          collection: 'users',
          field: 'addresses',
          path: '$[*].kind',
          from: 1,
          to: { $toDouble: 2 },
          filter: { type: 'admin' },
        }),
      ),
    ).toEqual({
      id: 'storedValue.users.addresses.$[*].kind.replace(1).where({"type":"admin"})',
      name: 'storedValue.users.addresses.$[*].kind.replace(1).where({"type":"admin"})',
      label:
        'Replace value 1 with 2 at path "$[*].kind" in field addresses of collection users in documents whose type is "admin"',
      operationClass: 'widening',
      meta: {
        rewrite: {
          kind: 'replaceStoredValue',
          collection: 'users',
          field: 'addresses',
          path: '$[*].kind',
        },
      },
      precheck: [],
      postcheck: ['no document in users holds value 1 at path "$[*].kind" in field addresses'],
      runs: 1,
    });
  });
});

describe('removeStoredValue', () => {
  it('removes the value from an optional field with no check before', () => {
    expect(
      summary(removeStoredValue({ collection: 'users', field: 'status', value: 'archived' })),
    ).toEqual({
      id: 'storedValue.users.status.remove("archived")',
      name: 'storedValue.users.status.remove("archived")',
      label: 'Remove value "archived" from field status of collection users',
      operationClass: 'destructive',
      meta: {
        rewrite: {
          kind: 'removeStoredValue',
          collection: 'users',
          field: 'status',
          value: 'archived',
        },
      },
      precheck: [],
      postcheck: ['no document in users holds value "archived" in field status'],
      runs: 1,
    });
  });

  it('checks first that no required place holds the value, and carries the enum value', () => {
    expect(
      summary(
        removeStoredValue({
          collection: 'users',
          field: 'profile',
          path: '$.status',
          value: 'archived',
          required: true,
          enumValue: { enum: 'Status', member: 'ARCHIVED' },
        }),
      ),
    ).toMatchObject({
      label: 'Remove value "archived" at path "$.status" in field profile of collection users',
      meta: {
        rewrite: {
          kind: 'removeStoredValue',
          collection: 'users',
          field: 'profile',
          path: '$.status',
          value: 'archived',
          enumValue: { enum: 'Status', member: 'ARCHIVED' },
        },
      },
      precheck: [
        'no document in users holds value "archived" at path "$.status" in field profile, which is required',
      ],
    });
  });
});

describe('stored value refusals', () => {
  it('refuses an object or a list as the value to match', () => {
    expect(() =>
      replaceStoredValue({
        collection: 'users',
        field: 'status',
        from: blindValue({ a: 1 }),
        to: 'b',
      }),
    ).toThrow(
      'replaceStoredValue cannot match value {"a":1} in field status of collection users: it compares only strings, numbers and booleans.',
    );
  });

  it('refuses a path that does not end at a key', () => {
    expect(() =>
      removeStoredValue({ collection: 'users', field: 'tags', path: '$[*]', value: 'a' }),
    ).toThrow('removeStoredValue cannot act at path "$[*]" in field tags of collection users');
  });

  it('refuses a root field the field rewrites refuse', () => {
    expect(() => removeStoredValue({ collection: 'users', field: '$status', value: 'a' })).toThrow(
      'Field "$status" in collection users cannot be rewritten',
    );
  });
});

function blindValue(value: unknown): string {
  return value as string;
}

describe('stored value operations in ops.json', () => {
  const ops = [
    replaceStoredValue({ collection: 'users', field: 'status', from: 'a', to: { $literal: 'b' } }),
    removeStoredValue({
      collection: 'users',
      field: 'addresses',
      path: '$[*].kind',
      value: true,
      required: true,
      enumValue: { namespaceId: 'app', enum: 'Kind', member: 'YES' },
      filter: { type: 'admin' },
    }),
  ];

  it('round-trip, and read as rewrites of their root field', () => {
    expect({
      roundTrip: deserializeMongoOps(JSON.parse(serializeMongoOps(ops)) as unknown[]),
      fields: ops.map((op) => fieldRewriteOf(op)?.field),
    }).toEqual({ roundTrip: ops, fields: ['status', 'addresses'] });
  });
});

describe('stored value calls', () => {
  it('render the calls migration.ts writes, and lower to their factories', () => {
    const replace = new ReplaceStoredValueCall({
      collection: 'users',
      field: 'status',
      from: 'a',
      to: { $literal: 'b' },
    });
    const remove = new RemoveStoredValueCall({
      collection: 'users',
      field: 'addresses',
      path: '$[*].kind',
      value: 'a',
      required: true,
      enumValue: { enum: 'Kind', member: 'A' },
    });
    const source = (call: { renderTypeScript(): string }) =>
      call
        .renderTypeScript()
        .replace(/\s+/g, '')
        .replace(/,(?=[\]}])/g, '');

    expect(
      [replace, remove].map((call) => ({
        source: source(call),
        operationClass: call.operationClass,
        label: call.label,
        op: call.toOp(),
      })),
    ).toEqual([
      {
        source:
          'replaceStoredValue({collection:"users",field:"status",from:"a",to:{$literal:"b"}})',
        operationClass: 'widening',
        label: 'Replace value "a" with "b" in field status of collection users',
        op: replaceStoredValue({
          collection: 'users',
          field: 'status',
          from: 'a',
          to: { $literal: 'b' },
        }),
      },
      {
        source:
          'removeStoredValue({collection:"users",field:"addresses",path:"$[*].kind",value:"a",required:true,enumValue:{enum:"Kind",member:"A"}})',
        operationClass: 'destructive',
        label: 'Remove value "a" at path "$[*].kind" in field addresses of collection users',
        op: removeStoredValue({
          collection: 'users',
          field: 'addresses',
          path: '$[*].kind',
          value: 'a',
          required: true,
          enumValue: { enum: 'Kind', member: 'A' },
        }),
      },
    ]);
  });
});
