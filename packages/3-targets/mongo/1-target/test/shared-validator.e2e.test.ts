import { describe, expect, it } from 'vitest';
import { serializeMongoOps } from '../src/core/migrations/mongo-ops-serializer';
import {
  CheckDocumentsCall,
  CollModCall,
  FillFieldCall,
} from '../src/core/migrations/op-factory-call';
import { renderCallsToTypeScript } from '../src/core/migrations/render-typescript';
import { factoryExport, useMigrationDirectory } from './migration-file-harness';

const SNAPSHOTS_IMPORT_PATH = './snapshots';
const meta = {
  from: 'a'.repeat(64),
  to: 'b'.repeat(64),
  snapshotsImportPath: SNAPSHOTS_IMPORT_PATH,
};
const directory = useMigrationDirectory(SNAPSHOTS_IMPORT_PATH);

const validator = {
  bsonType: 'object',
  required: ['_id', 'email', 'plan'],
  properties: {
    _id: { bsonType: 'objectId' },
    email: { bsonType: 'string' },
    plan: { bsonType: 'string' },
  },
  additionalProperties: false,
};
const calls = [
  new CheckDocumentsCall({ collection: 'users', validator, rewrittenFields: ['plan'] }),
  new FillFieldCall({ collection: 'users', field: 'plan', value: { $literal: '' } }),
  new CollModCall(
    'users',
    { validator: { $jsonSchema: validator }, validationLevel: 'strict', validationAction: 'error' },
    { id: 'validator.users.update', label: 'Update validator on users', checkDocuments: true },
  ),
];

function rendered(): string {
  return renderCallsToTypeScript(calls, meta).replace(
    "'@internal/target-mongo/migration'",
    `'${factoryExport}'`,
  );
}

describe('a migration.ts with an early document check', () => {
  it('declares the validator once, and the check and the validator change both use it', () => {
    const source = rendered();

    expect({
      declarations: source.match(/const usersValidator = /g)?.length,
      check: source.replace(/\s+/g, '').includes('validator:usersValidator,rewrittenFields'),
      validatorChange: source.replace(/\s+/g, '').includes('$jsonSchema:usersValidator'),
    }).toEqual({ declarations: 1, check: true, validatorChange: true });
  });

  it('reproduces the planned operations when it runs', async () => {
    await directory.writeMigration(rendered(), meta);

    expect(await directory.runMigration()).toEqual({ exitCode: 0, stderr: '' });
    expect(await directory.readOps()).toEqual(
      JSON.parse(serializeMongoOps(calls.map((call) => call.toOp()))),
    );
  });

  it('applies an edit of the validator to the check and to the validator change', async () => {
    await directory.writeMigration(
      rendered().replace(
        'required: ["_id", "email", "plan"]',
        'required: ["_id", "email", "plan", "nick"]',
      ),
      meta,
    );

    expect((await directory.runMigration()).exitCode).toBe(0);
    const ops = await directory.readOps();
    const [check, , validatorChange] = Array.isArray(ops)
      ? ops.map((op) => JSON.stringify(op))
      : [];
    expect({
      check: check?.includes('"required":["_id","email","nick"]'),
      validatorChange: validatorChange?.includes('"required":["_id","email","plan","nick"]'),
    }).toEqual({ check: true, validatorChange: true });
  });

  it('shares the const only with a validator change whose validator is the same value', async () => {
    const other = { ...validator, required: ['_id', 'email'] };
    const twoChanges = [
      ...calls,
      new CollModCall(
        'users',
        { validator: { $jsonSchema: other }, validationLevel: 'strict', validationAction: 'error' },
        { id: 'validator.users.loosen', label: 'Loosen validator on users', checkDocuments: true },
      ),
    ];
    const source = renderCallsToTypeScript(twoChanges, meta).replace(
      "'@internal/target-mongo/migration'",
      `'${factoryExport}'`,
    );
    await directory.writeMigration(source, meta);

    expect({
      uses: source.match(/usersValidator\b/g)?.length,
      run: await directory.runMigration(),
    }).toEqual({ uses: 3, run: { exitCode: 0, stderr: '' } });
    expect(await directory.readOps()).toEqual(
      JSON.parse(serializeMongoOps(twoChanges.map((call) => call.toOp()))),
    );
  });
});
