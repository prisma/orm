import type { ControlDriverInstance } from '@internal/framework-components/control';
import { ListCollectionsCommand } from '@internal/mongo-query-ast/control';
import { MongoSchemaIR } from '@internal/mongo-schema-ir';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it, vi } from 'vitest';
import { MongoControlAdapterImpl } from '../src/core/mongo-control-adapter';
import { extractDb } from '../src/core/mongo-control-driver';

function fakeControlDriver(db: unknown = { __id: 'fake-db' }) {
  return {
    familyId: 'mongo',
    targetId: 'mongo',
    db,
    execute: () => {
      throw new Error('not used');
    },
    run: async () => {},
    close: async () => {},
  } as unknown as ControlDriverInstance<'mongo', 'mongo'>;
}

describe('extractDb', () => {
  it('returns the db reference attached to the mongo control driver', () => {
    const fakeDb = { __id: 'fake-db' } as unknown;
    const driver = {
      familyId: 'mongo',
      targetId: 'mongo',
      db: fakeDb,
      execute: () => {
        throw new Error('not used');
      },
      close: async () => {},
    } as unknown as ControlDriverInstance<'mongo', 'mongo'>;
    expect(extractDb(driver)).toBe(fakeDb);
  });

  it('throws when the value is not a Mongo control driver', () => {
    const driver = {} as unknown as ControlDriverInstance<'mongo', 'mongo'>;
    expect(() => extractDb(driver)).toThrowError(/Expected a Mongo control driver/);
  });

  it('throws CONFIG.VALIDATION_FAILED when the value is not a Mongo control driver', () => {
    const driver = { familyId: 'mongo' } as unknown as ControlDriverInstance<'mongo', 'mongo'>;
    let caught: unknown;
    try {
      extractDb(driver);
    } catch (err) {
      caught = err;
    }
    expect(isStructuredError(caught)).toBe(true);
    if (!isStructuredError(caught)) return;
    expect(caught.code).toBe('CONFIG.VALIDATION_FAILED');
    expect(caught.meta).toEqual({ received: 'object with keys [familyId]' });
  });
});

describe('MongoControlAdapterImpl.createRunnerDependencies', () => {
  it('uses the control driver as the runner driver', () => {
    const driver = fakeControlDriver();
    const deps = new MongoControlAdapterImpl().createRunnerDependencies(driver);
    expect(deps.driver).toBe(driver);
  });

  it('routes marker operations through the control adapter with the control driver', async () => {
    const adapter = new MongoControlAdapterImpl();
    const readMarker = vi.spyOn(adapter, 'readMarker').mockResolvedValue(null);
    const driver = fakeControlDriver();

    await adapter.createRunnerDependencies(driver).markerOps.readMarker('app');

    expect(readMarker).toHaveBeenCalledWith(driver, 'app');
  });

  it('routes introspection through the control adapter with the control driver', async () => {
    const adapter = new MongoControlAdapterImpl();
    const schema = new MongoSchemaIR([]);
    const introspectSchema = vi.spyOn(adapter, 'introspectSchema').mockResolvedValue(schema);
    const driver = fakeControlDriver();

    expect(await adapter.createRunnerDependencies(driver).introspectSchema()).toBe(schema);
    expect(introspectSchema).toHaveBeenCalledWith(driver);
  });

  it('builds the inspection executor over the control driver db', async () => {
    const rows = [{ name: 'users' }];
    const db = { listCollections: () => ({ toArray: async () => rows }) };
    const deps = new MongoControlAdapterImpl().createRunnerDependencies(fakeControlDriver(db));

    expect(await deps.inspectionExecutor.listCollections(new ListCollectionsCommand())).toBe(rows);
  });

  it('throws CONFIG.VALIDATION_FAILED when the value is not a Mongo control driver', () => {
    const driver = { familyId: 'mongo' } as unknown as ControlDriverInstance<'mongo', 'mongo'>;
    expect(() => new MongoControlAdapterImpl().createRunnerDependencies(driver)).toThrow(
      expect.objectContaining({ code: 'CONFIG.VALIDATION_FAILED' }),
    );
  });
});
