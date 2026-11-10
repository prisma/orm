import type { Contract } from '@internal/contract/types';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlDriverInstance,
  ControlFamilyDescriptor,
  ControlFamilyInstance,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { createControlClient } from '../../src/control-api/client';

const TEST_INVOCATION = { cwd: '/work/app', configPath: undefined, dbGiven: false };

function createMockComponents(overrides?: { deserializeContract?: (json: unknown) => Contract }) {
  const mockDriver = {
    close: async () => {},
  } as unknown as ControlDriverInstance<string, string>;

  const mockFamilyInstance = {
    deserializeContract: overrides?.deserializeContract ?? ((json: unknown) => json as Contract),
    readMarker: async () => null,
  } as unknown as ControlFamilyInstance<string, unknown>;

  const mockFamily = {
    familyId: 'sql',
    create: () => mockFamilyInstance,
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlFamilyDescriptor<any, any>;

  const mockTarget = {
    kind: 'target',
    targetId: 'postgres',
    familyId: 'sql',
    contractSerializer: {
      serializeContract: (contract: unknown) => contract,
      deserializeContract: (json: unknown) => json,
    },
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlTargetDescriptor<any, any, any>;

  const mockAdapter = {
    kind: 'adapter',
    familyId: 'sql',
    targetId: 'postgres',
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlAdapterDescriptor<any, any, any>;

  const mockDriverDescriptor = {
    targetId: 'postgres',
    create: async () => mockDriver,
    // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
  } as unknown as ControlDriverDescriptor<any, any, any, any>;

  return { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor };
}

async function capture(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the control client call to reject');
}

describe('ControlClient structured error codes', () => {
  it('raises DRIVER.ALREADY_CONNECTED when connect() is called twice', async () => {
    const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();
    const client = createControlClient({
      family: mockFamily,
      target: mockTarget,
      adapter: mockAdapter,
      driver: mockDriverDescriptor,
    });
    await client.connect('postgres://test');
    const error = await capture(() => client.connect('postgres://test'));
    await client.close();
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'DRIVER.ALREADY_CONNECTED' });
  });

  it('raises CONFIG.DB_CONNECTION_REQUIRED when connect() has no connection', async () => {
    const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();
    const client = createControlClient({
      family: mockFamily,
      target: mockTarget,
      adapter: mockAdapter,
      driver: mockDriverDescriptor,
    });
    const error = await capture(() => client.connect());
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONFIG.DB_CONNECTION_REQUIRED' });
  });

  it('raises CONFIG.DRIVER_REQUIRED when no driver descriptor is configured', async () => {
    const { mockFamily, mockTarget, mockAdapter } = createMockComponents();
    const client = createControlClient({
      family: mockFamily,
      target: mockTarget,
      adapter: mockAdapter,
    });
    const error = await capture(() => client.connect('postgres://test'));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONFIG.DRIVER_REQUIRED' });
  });

  it('raises DRIVER.NOT_CONNECTED for operations before connect()', async () => {
    const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();
    const client = createControlClient({
      family: mockFamily,
      target: mockTarget,
      adapter: mockAdapter,
      driver: mockDriverDescriptor,
    });
    const error = await capture(() => client.verify({ contract: {} }));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
  });

  it('raises MIGRATION.TARGET_UNSUPPORTED when the target lacks migrations', async () => {
    const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();
    const client = createControlClient({
      family: mockFamily,
      target: mockTarget,
      adapter: mockAdapter,
      driver: mockDriverDescriptor,
    });
    const error = await capture(() =>
      client.dbInit({
        invocation: TEST_INVOCATION,
        contract: {},
        mode: 'plan',
        migrationsDir: '/tmp/does-not-matter',
        connection: 'postgres://test',
      }),
    );
    await client.close();
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'MIGRATION.TARGET_UNSUPPORTED' });
  });

  it('raises CONTRACT.VALIDATION_FAILED when contract deserialization fails', async () => {
    const cause = new Error('bad contract shape');
    const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents({
      deserializeContract: () => {
        throw cause;
      },
    });
    const client = createControlClient({
      family: mockFamily,
      target: mockTarget,
      adapter: mockAdapter,
      driver: mockDriverDescriptor,
    });
    const error = await capture(() =>
      client.verify({ contract: {}, connection: 'postgres://test' }),
    );
    await client.close();
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONTRACT.VALIDATION_FAILED', cause });
    expect((error as Error).message).toBe('bad contract shape');
  });
});
