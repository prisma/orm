import type { CollModOptions } from '@internal/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import {
  CollModCall,
  CreateCollectionCall,
  CreateIndexCall,
  DropCollectionCall,
  DropIndexCall,
} from '../src/core/migrations/op-factory-call';
import { renderCallsToTypeScript } from '../src/core/migrations/render-typescript';

const SNAPSHOTS_IMPORT_PATH = '../../snapshots';
const FROM_HEX = 'a'.repeat(64);
const TO_HEX = 'b'.repeat(64);
const META = {
  from: FROM_HEX,
  to: TO_HEX,
  snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
} as const;

const renderTypeScript = (
  calls: Parameters<typeof renderCallsToTypeScript>[0],
  meta: Parameters<typeof renderCallsToTypeScript>[1] = META,
) => renderCallsToTypeScript(calls, meta);

describe('renderCallsToTypeScript', () => {
  it('generates valid TypeScript with correct imports', () => {
    const calls = [
      new CreateIndexCall('users', [{ field: 'email', direction: 1 }], { unique: true }),
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain(
      "import { Migration, MigrationCLI, createIndex } from '@internal/target-mongo/migration';",
    );
    expect(output).toContain('override get operations()');
    expect(output).toContain('export default M;');
    expect(output).toContain('MigrationCLI.run(import.meta.url, M);');
  });

  it('emits the contract-JSON imports + fields and the Migration<Start, End> header (with-start)', () => {
    const calls = [new CreateIndexCall('users', [{ field: 'email', direction: 1 }])];

    const output = renderTypeScript(calls, META);

    expect(output).toContain(
      `import endContract from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract.json' with { type: "json" };`,
    );
    expect(output).toContain(
      `import startContract from '${SNAPSHOTS_IMPORT_PATH}/${FROM_HEX}/contract.json' with { type: "json" };`,
    );
    expect(output).toContain(
      `import type { Contract as End } from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract';`,
    );
    expect(output).toContain(
      `import type { Contract as Start } from '${SNAPSHOTS_IMPORT_PATH}/${FROM_HEX}/contract';`,
    );
    expect(output).toContain('class M extends Migration<Start, End> {');
    expect(output).toContain('override readonly startContractJson = startContract;');
    expect(output).toContain('override readonly endContractJson = endContract;');
  });

  it('does NOT emit a describe() method (the base derives it from the contract JSON)', () => {
    const calls = [new DropCollectionCall('users')];

    const output = renderTypeScript(calls, META);

    expect(output).not.toContain('describe()');
    // The hash values are no longer literal-embedded — they come from the JSON.
    expect(output).not.toContain(`'${META.from}'`);
    expect(output).not.toContain(`'${META.to}'`);
  });

  it('renders a compilable merged import block when from === to (E4)', () => {
    const calls = [new DropCollectionCall('users')];

    const output = renderTypeScript(calls, {
      from: META.to,
      to: META.to,
      snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
    });

    expect(output).toContain(
      `import endContract from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract.json' with { type: "json" };`,
    );
    expect(output).toContain(
      `import startContract from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract.json' with { type: "json" };`,
    );
    expect(output).toContain(
      `import type { Contract as End, Contract as Start } from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract';`,
    );
    expect(output).toContain('class M extends Migration<Start, End> {');
  });

  it('prepends a node shebang as the first line under the default test env', () => {
    const calls = [new CreateIndexCall('users', [{ field: 'email', direction: 1 }])];

    const output = renderTypeScript(calls);

    expect(output.split('\n')[0]).toBe('#!/usr/bin/env -S node');
    expect(output).toContain('MigrationCLI.run(import.meta.url, M);');
  });

  it('only imports used factory functions', () => {
    const calls = [
      new CreateIndexCall('users', [{ field: 'email', direction: 1 }]),
      new DropCollectionCall('legacy'),
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('createIndex');
    expect(output).toContain('dropCollection');
    expect(output).not.toContain('dropIndex');
    expect(output).not.toContain('createCollection');
    expect(output).not.toContain('collMod');
  });

  it('renders createIndex with options', () => {
    const calls = [
      new CreateIndexCall('users', [{ field: 'email', direction: 1 }], {
        unique: true,
        sparse: true,
      }),
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('createIndex("users"');
    expect(output).toContain('unique: true');
    expect(output).toContain('sparse: true');
  });

  it('renders createIndex without options when absent', () => {
    const calls = [new CreateIndexCall('users', [{ field: 'email', direction: 1 }])];

    const output = renderTypeScript(calls);

    expect(output).toMatch(/createIndex\("users", \[.*\]\)/);
  });

  it('renders dropIndex', () => {
    const calls = [new DropIndexCall('users', [{ field: 'email', direction: 1 }])];

    const output = renderTypeScript(calls);

    expect(output).toContain('dropIndex("users"');
  });

  it('renders createCollection without options', () => {
    const calls = [new CreateCollectionCall('users')];

    const output = renderTypeScript(calls);

    expect(output).toContain('createCollection("users")');
  });

  it('renders createCollection with options', () => {
    const calls = [
      new CreateCollectionCall('users', {
        validator: { $jsonSchema: { required: ['email'] } },
        validationLevel: 'strict',
      }),
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('createCollection("users"');
    expect(output).toContain('validator');
    expect(output).toContain('validationLevel');
  });

  it('renders dropCollection', () => {
    const calls = [new DropCollectionCall('users')];

    const output = renderTypeScript(calls);

    expect(output).toContain('dropCollection("users")');
  });

  it('renders collMod without meta', () => {
    const calls = [
      new CollModCall('users', {
        validator: { $jsonSchema: { required: ['email'] } },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('collMod("users"');
    expect(output).toContain('validator');
  });

  it('renders collMod with meta', () => {
    const calls = [
      new CollModCall(
        'users',
        {
          validator: { $jsonSchema: { required: ['email'] } },
        },
        {
          id: 'validator.users.add',
          label: 'Add validator on users',
          operationClass: 'destructive',
        },
      ),
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('collMod("users"');
    expect(output).toContain('"validator.users.add"');
    expect(output).toContain('"Add validator on users"');
    expect(output).toContain('"destructive"');
  });

  it('renders multiple calls', () => {
    const calls = [
      new CreateCollectionCall('users', {
        validator: { $jsonSchema: { required: ['email'] } },
        validationLevel: 'strict',
        validationAction: 'error',
      }),
      new CreateIndexCall('users', [{ field: 'email', direction: 1 }], { unique: true }),
      new CreateIndexCall('users', [
        { field: 'name', direction: 1 },
        { field: 'age', direction: -1 },
      ]),
    ];

    const output = renderTypeScript(calls);

    expect(output).toContain('createCollection');
    expect(output).toContain('createIndex');
    const importLine = output
      .split('\n')
      .find((l) => l.includes('@internal/target-mongo/migration'));
    expect(importLine).toContain('createCollection');
    expect(importLine).toContain('createIndex');
  });

  it('renders the baseline shape for from: null (no start imports, Migration<never, End>)', () => {
    const calls = [new DropCollectionCall('users')];

    const output = renderTypeScript(calls, {
      from: null,
      to: META.to,
      snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
    });

    expect(output).toContain('class M extends Migration<never, End> {');
    expect(output).toContain('override readonly endContractJson = endContract;');
    expect(output).toContain(
      `import endContract from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract.json' with { type: "json" };`,
    );
    expect(output).toContain(
      `import type { Contract as End } from '${SNAPSHOTS_IMPORT_PATH}/${TO_HEX}/contract';`,
    );
    // No start contract for a baseline.
    expect(output).not.toContain('startContract');
    expect(output).not.toContain('startContractJson');
    expect(output).not.toContain('describe()');
  });

  it('handles empty calls array', () => {
    const output = renderTypeScript([]);

    expect(output).toContain(
      "import { Migration, MigrationCLI } from '@internal/target-mongo/migration';",
    );
    expect(output).toContain('return [');
    expect(output).toContain('];');
  });

  it('wraps long arrays onto multiple lines', () => {
    const calls = [
      new CreateIndexCall('users', [
        { field: 'first_name', direction: 1 },
        { field: 'last_name', direction: 1 },
        { field: 'email_address', direction: 1 },
        { field: 'phone_number', direction: 1 },
      ]),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('[\n');
  });

  it('quotes __proto__ key in rendered object literals', () => {
    const opts = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(opts, '__proto__', {
      value: 'poisoned',
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const calls = [
      new CollModCall('test', opts as CollModOptions, {
        id: 'test',
        label: 'test',
        operationClass: 'destructive',
      }),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('"__proto__"');
  });

  it('throws on non-JSON value types', () => {
    const calls = [
      new CollModCall('test', { validator: BigInt(42) } as unknown as CollModOptions, {
        id: 'test',
        label: 'test',
        operationClass: 'destructive',
      }),
    ];
    expect(() => renderTypeScript(calls)).toThrow('unsupported value type');
  });

  it('renders null values', () => {
    const calls = [
      new CollModCall('test', { validator: null } as unknown as CollModOptions, {
        id: 'test',
        label: 'test',
        operationClass: 'destructive',
      }),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('null');
  });

  it('renders empty arrays as []', () => {
    const calls = [
      new CreateCollectionCall('test', {
        validator: { $jsonSchema: { required: [] } },
      }),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('[]');
  });

  it('renders empty objects as {}', () => {
    const calls = [
      new CollModCall('test', { validator: {} } as CollModOptions, {
        id: 'test',
        label: 'test',
        operationClass: 'destructive',
      }),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('{}');
  });

  it('quotes keys with special characters', () => {
    const calls = [
      new CollModCall('test', { 'some-key': true } as unknown as CollModOptions, {
        id: 'test',
        label: 'test',
        operationClass: 'destructive',
      }),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('"some-key"');
  });

  it('renders undefined values in arrays', () => {
    const calls = [
      new CollModCall('test', { validator: [undefined, 'a'] } as unknown as CollModOptions, {
        id: 'test',
        label: 'test',
        operationClass: 'destructive',
      }),
    ];
    const output = renderTypeScript(calls);
    expect(output).toContain('undefined');
    expect(output).toContain('"a"');
  });
});
