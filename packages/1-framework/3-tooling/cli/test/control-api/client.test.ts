import type { ContractSourceProvider } from '@internal/config/config-types';
import type { Contract, LedgerEntryRecord } from '@internal/contract/types';
import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlDriverInstance,
  ControlFamilyDescriptor,
  ControlFamilyInstance,
  ControlTargetDescriptor,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import type { EmissionSpi } from '@internal/framework-components/emission';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok } from '@internal/utils/result';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createControlClient } from '../../src/control-api/client';
import type { ControlProgressEvent } from '../../src/control-api/types';

/**
 * The smallest contract the real emitter accepts: a storage envelope with a
 * hash and no models. No module mocks — the emit tests run the real
 * `@internal/emitter` over this, so they hold regardless of which test file
 * warmed the module registry first (`isolate: false` shares it).
 */
function emittableContract(): Contract {
  return {
    schemaVersion: '1.0.0',
    target: 'postgres',
    targetFamily: 'sql',
    roots: {},
    domain: { namespaces: { app: { models: {} } } },
    storage: { storageHash: 'test-storage-hash', namespaces: { app: { tables: {} } } },
    extensions: {},
    capabilities: {},
    meta: {},
    profileHash: 'test-profile-hash',
    models: {},
  } as unknown as Contract;
}

function createSourceProvider(
  load: ContractSourceProvider['load'] = async () => ok(emittableContract()),
  inputs?: readonly string[],
): ContractSourceProvider {
  return {
    ...ifDefined('inputs', inputs),
    load,
  };
}

function createMockComponents() {
  const mockDriver = {
    close: async () => {},
  } as unknown as ControlDriverInstance<string, string>;

  const mockIntrospect = vi.fn(
    async (_options: { driver: unknown; contract?: unknown; schema?: string }) => ({ tables: [] }),
  );

  const mockFamilyInstance = {
    introspect: mockIntrospect,
    deserializeContract: (ir: unknown) => ir as Contract,
    readMarker: async () => null,
    readLedger: async () => [],
    verify: async (): Promise<VerifyDatabaseResult> => ({
      ok: true,
      summary: 'Verification passed',
      contract: { storageHash: 'test-hash' },
      marker: { storageHash: 'test-hash' },
      target: { expected: 'postgres' },
      timings: { total: 10 },
    }),
    verifySchema: (): VerifyDatabaseSchemaResult => ({
      ok: true,
      summary: 'Schema verification passed',
      contract: { storageHash: 'test-hash' },
      target: { expected: 'postgres' },
      schema: {
        issues: [],
      },
      timings: { total: 10 },
    }),
    sign: async (): Promise<SignDatabaseResult> => ({
      ok: true,
      summary: 'Database signed successfully',
      contract: { storageHash: 'test-hash' },
      target: { expected: 'postgres' },
      marker: { created: false, updated: true },
      timings: { total: 10 },
    }),
  } as unknown as ControlFamilyInstance<string, unknown>;

  const mockHook: EmissionSpi = {
    id: 'sql',
    generateStorageType: () =>
      '{ readonly tables: Record<string, never>; readonly types: Record<string, never>; readonly storageHash: StorageHash }',
    generateModelStorageType: () => 'Record<string, never>',
    getFamilyImports: () => [
      "import type { ContractWithTypeMaps, TypeMaps as TypeMapsType } from '@internal/sql-contract/types';",
    ],
    getFamilyTypeAliases: () => '',
    getTypeMapsExpression: () => 'TypeMapsType<CodecTypes, OperationTypes>',
    getContractWrapper: (base: string, tm: string) =>
      `export type Contract = ContractWithTypeMaps<${base}, ${tm}>;`,
  };

  const mockFamily = {
    familyId: 'sql',
    emission: mockHook,
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

  return {
    mockDriver,
    mockFamilyInstance,
    mockIntrospect,
    mockFamily,
    mockTarget,
    mockAdapter,
    mockDriverDescriptor,
  };
}

describe('ControlClient progress emission', () => {
  describe('verify()', () => {
    it('emits connect and verify spans when connection provided', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.verify({
        contract: {},
        connection: 'postgres://test',
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should emit connect span
      const connectStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'connect');
      const connectEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'connect');
      expect(connectStart).toBeDefined();
      expect(connectEnd).toMatchObject({ outcome: 'ok' });

      // Should emit verify span
      const verifyStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'verify');
      const verifyEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'verify');
      expect(verifyStart).toBeDefined();
      expect(verifyEnd).toMatchObject({ outcome: 'ok' });

      // All events should have action = 'verify'
      for (const event of events) {
        expect(event.action).toBe('verify');
      }
    });

    it('emits only verify span when already connected', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      // Connect first
      await client.connect('postgres://test');

      await client.verify({
        contract: {},
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should NOT emit connect span
      const connectStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'connect');
      expect(connectStart).toBeUndefined();

      // Should emit verify span
      const verifyStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'verify');
      expect(verifyStart).toBeDefined();
    });
  });

  describe('schemaVerify()', () => {
    it('emits connect and schemaVerify spans when connection provided', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.schemaVerify({
        contract: {},
        connection: 'postgres://test',
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should emit connect span
      const connectStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'connect');
      const connectEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'connect');
      expect(connectStart).toBeDefined();
      expect(connectEnd).toMatchObject({ outcome: 'ok' });

      // Should emit schemaVerify span
      const schemaVerifyStart = events.find(
        (e) => e.kind === 'spanStart' && e.spanId === 'schemaVerify',
      );
      const schemaVerifyEnd = events.find(
        (e) => e.kind === 'spanEnd' && e.spanId === 'schemaVerify',
      );
      expect(schemaVerifyStart).toBeDefined();
      expect(schemaVerifyEnd).toMatchObject({ outcome: 'ok' });

      // All events should have action = 'schemaVerify'
      for (const event of events) {
        expect(event.action).toBe('schemaVerify');
      }
    });

    it('emits error outcome when schema verification fails', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor, mockFamilyInstance } =
        createMockComponents();

      // Override verifySchema to return a failure
      (
        mockFamilyInstance as unknown as {
          verifySchema: () => VerifyDatabaseSchemaResult;
        }
      ).verifySchema = (): VerifyDatabaseSchemaResult => ({
        ok: false,
        summary: 'Schema mismatch',
        contract: { storageHash: 'test-hash' },
        target: { expected: 'postgres' },
        schema: {
          issues: [
            {
              path: ['root'],
            },
          ],
        },
        timings: { total: 10 },
      });

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.schemaVerify({
        contract: {},
        connection: 'postgres://test',
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should emit schemaVerify span with error outcome
      const schemaVerifyEnd = events.find(
        (e) => e.kind === 'spanEnd' && e.spanId === 'schemaVerify',
      );
      expect(schemaVerifyEnd).toMatchObject({ outcome: 'error' });
    });
  });

  describe('sign()', () => {
    it('emits connect and sign spans when connection provided', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.sign({
        contract: {},
        connection: 'postgres://test',
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should emit connect span
      const connectStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'connect');
      const connectEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'connect');
      expect(connectStart).toBeDefined();
      expect(connectEnd).toMatchObject({ outcome: 'ok' });

      // Should emit sign span
      const signStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'sign');
      const signEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'sign');
      expect(signStart).toBeDefined();
      expect(signEnd).toMatchObject({ outcome: 'ok' });

      // All events should have action = 'sign'
      for (const event of events) {
        expect(event.action).toBe('sign');
      }
    });
  });

  describe('introspect()', () => {
    it('emits connect and introspect spans when connection provided', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.introspect({
        connection: 'postgres://test',
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should emit connect span
      const connectStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'connect');
      const connectEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'connect');
      expect(connectStart).toBeDefined();
      expect(connectEnd).toMatchObject({ outcome: 'ok' });

      // Should emit introspect span
      const introspectStart = events.find(
        (e) => e.kind === 'spanStart' && e.spanId === 'introspect',
      );
      const introspectEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'introspect');
      expect(introspectStart).toBeDefined();
      expect(introspectEnd).toMatchObject({ outcome: 'ok' });

      // All events should have action = 'introspect'
      for (const event of events) {
        expect(event.action).toBe('introspect');
      }
    });

    it('emits only introspect span when already connected', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      // Connect first
      await client.connect('postgres://test');

      await client.introspect({
        onProgress: (event) => events.push(event),
      });

      await client.close();

      // Should NOT emit connect span
      const connectStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'connect');
      expect(connectStart).toBeUndefined();

      // Should emit introspect span
      const introspectStart = events.find(
        (e) => e.kind === 'spanStart' && e.spanId === 'introspect',
      );
      expect(introspectStart).toBeDefined();
    });

    it('forwards the schema option to the family instance', async () => {
      const {
        mockFamily,
        mockTarget,
        mockAdapter,
        mockDriverDescriptor,
        mockIntrospect,
        mockDriver,
      } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.introspect({ connection: 'postgres://test', schema: 'sales' });
      await client.close();

      expect(mockIntrospect).toHaveBeenCalledWith({ driver: mockDriver, schema: 'sales' });
    });

    it('omits schema when the caller did not request one', async () => {
      const {
        mockFamily,
        mockTarget,
        mockAdapter,
        mockDriverDescriptor,
        mockIntrospect,
        mockDriver,
      } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.introspect({ connection: 'postgres://test' });
      await client.close();

      expect(mockIntrospect).toHaveBeenCalledWith({ driver: mockDriver });
    });
  });

  describe('emit()', () => {
    it(
      'emits resolveSource and emit spans',
      async () => {
        const events: ControlProgressEvent[] = [];
        const { mockFamily, mockTarget, mockAdapter } = createMockComponents();

        const client = createControlClient({
          family: mockFamily,
          target: mockTarget,
          adapter: mockAdapter,
          // No driver needed for emit
        });

        const result = await client.emit({
          contractConfig: {
            source: createSourceProvider(),
            output: '/tmp/contract.json',
          },
          onProgress: (event) => events.push(event),
        });

        await client.close();

        expect(result.ok).toBe(true);

        // Should emit resolveSource span
        const resolveSourceStart = events.find(
          (e) => e.kind === 'spanStart' && e.spanId === 'resolveSource',
        );
        const resolveSourceEnd = events.find(
          (e) => e.kind === 'spanEnd' && e.spanId === 'resolveSource',
        );
        expect(resolveSourceStart).toBeDefined();
        expect(resolveSourceEnd).toMatchObject({ outcome: 'ok' });

        // Should emit emit span
        const emitStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'emit');
        const emitEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'emit');
        expect(emitStart).toBeDefined();
        expect(emitEnd).toMatchObject({ outcome: 'ok' });

        // All events should have action = 'emit'
        for (const event of events) {
          expect(event.action).toBe('emit');
        }
      },
      timeouts.databaseOperation,
    );

    it(
      'passes declared source inputs to the provider',
      async () => {
        const { mockFamily, mockTarget, mockAdapter } = createMockComponents();
        const load = vi.fn<ContractSourceProvider['load']>(async () => ok(emittableContract()));
        const source = createSourceProvider(load, ['/tmp/schema.prisma']);

        const client = createControlClient({
          family: mockFamily,
          target: mockTarget,
          adapter: mockAdapter,
        });

        const result = await client.emit({
          contractConfig: {
            source,
            output: '/tmp/contract.json',
          },
        });

        await client.close();

        expect(result.ok).toBe(true);
        expect(load).toHaveBeenCalledWith(
          expect.objectContaining({
            resolvedInputs: ['/tmp/schema.prisma'],
          }),
        );
      },
      timeouts.databaseOperation,
    );

    it(
      'emits resolveSource and emit spans when source is a provider object',
      async () => {
        const events: ControlProgressEvent[] = [];
        const { mockFamily, mockTarget, mockAdapter } = createMockComponents();

        const client = createControlClient({
          family: mockFamily,
          target: mockTarget,
          adapter: mockAdapter,
        });

        const result = await client.emit({
          contractConfig: {
            source: createSourceProvider(),
            output: '/tmp/contract.json',
          },
          onProgress: (event) => events.push(event),
        });

        await client.close();

        expect(result.ok).toBe(true);

        // Should emit resolveSource span
        const resolveSourceStart = events.find(
          (e) => e.kind === 'spanStart' && e.spanId === 'resolveSource',
        );
        const resolveSourceEnd = events.find(
          (e) => e.kind === 'spanEnd' && e.spanId === 'resolveSource',
        );
        expect(resolveSourceStart).toBeDefined();
        expect(resolveSourceEnd).toMatchObject({ outcome: 'ok' });
      },
      timeouts.databaseOperation,
    );

    it('emits error outcome when source provider throws', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
      });

      const result = await client.emit({
        contractConfig: {
          source: createSourceProvider(async () => {
            throw new Error('Source load error');
          }),
          output: '/tmp/contract.json',
        },
        onProgress: (event) => events.push(event),
      });

      await client.close();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('CONTRACT_SOURCE_INVALID');
        expect(result.failure.diagnostics).toEqual({
          summary: 'Contract source provider threw an exception',
          diagnostics: [
            {
              code: 'PROVIDER_THROW',
              message: 'Source load error',
            },
          ],
        });
      }

      // Should emit resolveSource span with error outcome
      const resolveSourceEnd = events.find(
        (e) => e.kind === 'spanEnd' && e.spanId === 'resolveSource',
      );
      expect(resolveSourceEnd).toMatchObject({ outcome: 'error' });
    });

    it('returns provider diagnostics when source provider fails', async () => {
      const { mockFamily, mockTarget, mockAdapter } = createMockComponents();
      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
      });

      const result = await client.emit({
        contractConfig: {
          source: createSourceProvider(async () =>
            notOk({
              summary: 'Provider failed',
              diagnostics: [
                {
                  code: 'PSL_INVALID_MODEL',
                  message: 'Model declaration is invalid',
                  sourceId: 'schema.prisma',
                },
              ],
            }),
          ),
          output: '/tmp/contract.json',
        },
      });

      await client.close();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('CONTRACT_SOURCE_INVALID');
        expect(result.failure.diagnostics?.summary).toBe('Provider failed');
        expect(result.failure.diagnostics?.diagnostics).toHaveLength(1);
      }
    });

    it('emits error outcome when emit throws', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamily, mockTarget, mockAdapter } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
      });

      const result = await client.emit({
        contractConfig: {
          // A contract with no storage envelope makes the real emitter throw.
          source: createSourceProvider(async () => ok({} as unknown as Contract)),
          output: '/tmp/contract.json',
        },
        onProgress: (event) => events.push(event),
      });

      await client.close();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure.code).toBe('EMIT_FAILED');
      }

      // Should emit emit span with error outcome
      const emitEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'emit');
      expect(emitEnd).toMatchObject({ outcome: 'error' });
    });
  });

  describe('dbUpdate()', () => {
    function createMockComponentsWithMigrations() {
      const { mockDriver, mockAdapter, mockDriverDescriptor } = createMockComponents();

      // Override family instance to return a marker (db update works with or without one)
      const mockFamilyInstance = {
        introspect: async () => ({ tables: {} }),
        deserializeContract: (ir: unknown) => ir as Contract,
        readMarker: async () => ({ storageHash: 'origin' }),
        readAllMarkers: async () => new Map(),
      } as unknown as ControlFamilyInstance<string, unknown>;

      const mockFamilyWithMarker = {
        familyId: 'sql',
        create: () => mockFamilyInstance,
        // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
      } as unknown as ControlFamilyDescriptor<any, any>;

      const mockMigrations = {
        createPlanner: () => ({
          plan: () => ({
            kind: 'success',
            plan: {
              targetId: 'postgres',
              destination: { storageHash: 'dest' },
              operations: [
                {
                  id: 'op1',
                  label: 'Test op',
                  operationClass: 'additive',
                  sql: [],
                  prechecks: [],
                  postchecks: [],
                },
              ],
            },
          }),
        }),
        createRunner: () => ({
          execute: async () => ({
            ok: true,
            value: {
              perSpaceResults: [
                { space: 'app', value: { operationsPlanned: 1, operationsExecuted: 1 } },
              ],
            },
          }),
        }),
      };

      const mockTargetWithMigrations = {
        kind: 'target',
        targetId: 'postgres',
        familyId: 'sql',
        migrations: mockMigrations,
        // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
      } as unknown as ControlTargetDescriptor<any, any, any>;

      return {
        mockDriver,
        mockFamilyInstance,
        mockFamilyWithMarker,
        mockTargetWithMigrations,
        mockAdapter,
        mockDriverDescriptor,
      };
    }

    it('emits connect, introspect, plan, apply spans when connection provided', async () => {
      const events: ControlProgressEvent[] = [];
      const { mockFamilyWithMarker, mockTargetWithMigrations, mockAdapter, mockDriverDescriptor } =
        createMockComponentsWithMigrations();

      const client = createControlClient({
        family: mockFamilyWithMarker,
        target: mockTargetWithMigrations,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      const result = await client.dbUpdate({
        contract: {
          target: 'postgres',
          storage: { storageHash: 'fixture', tables: {}, namespaces: {} },
        },
        mode: 'apply',
        connection: 'postgres://test',
        migrationsDir: '/tmp/__test-client-migrations',
        acceptDataLoss: true,
        onProgress: (event) => events.push(event),
      });

      await client.close();

      expect(result.ok).toBe(true);

      const connectStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'connect');
      const connectEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'connect');
      expect(connectStart).toBeDefined();
      expect(connectEnd).toMatchObject({ outcome: 'ok' });

      const readMarkerStart = events.find(
        (e) => e.kind === 'spanStart' && e.spanId === 'readMarker',
      );
      expect(readMarkerStart).toBeUndefined();

      const planStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'plan');
      expect(planStart).toBeDefined();

      const applyEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'apply');
      expect(applyEnd).toMatchObject({ outcome: 'ok' });

      for (const event of events) {
        expect(event.action).toBe('dbUpdate');
      }
    });

    it('does not fail when marker is missing', async () => {
      const { mockTargetWithMigrations, mockAdapter, mockDriverDescriptor } =
        createMockComponentsWithMigrations();

      // Override to return null marker — db update no longer requires a marker
      const noMarkerFamilyInstance = {
        introspect: async () => ({ tables: {} }),
        deserializeContract: (ir: unknown) => ir as Contract,
        readMarker: async () => null,
        readAllMarkers: async () => new Map(),
      } as unknown as ControlFamilyInstance<string, unknown>;

      const noMarkerFamily = {
        familyId: 'sql',
        create: () => noMarkerFamilyInstance,
        // biome-ignore lint/suspicious/noExplicitAny: required for mock flexibility
      } as unknown as ControlFamilyDescriptor<any, any>;

      const client = createControlClient({
        family: noMarkerFamily,
        target: mockTargetWithMigrations,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      const result = await client.dbUpdate({
        contract: {
          target: 'postgres',
          storage: { storageHash: 'fixture', tables: {}, namespaces: {} },
        },
        mode: 'plan',
        connection: 'postgres://test',
        migrationsDir: '/tmp/__test-client-migrations',
      });

      expect(result.ok).toBe(true);

      await client.close();
    });

    it('does not throw when onProgress is omitted from dbUpdate', async () => {
      const { mockFamilyWithMarker, mockTargetWithMigrations, mockAdapter, mockDriverDescriptor } =
        createMockComponentsWithMigrations();

      const client = createControlClient({
        family: mockFamilyWithMarker,
        target: mockTargetWithMigrations,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      const result = await client.dbUpdate({
        contract: {
          target: 'postgres',
          storage: { storageHash: 'fixture', tables: {}, namespaces: {} },
        },
        mode: 'plan',
        connection: 'postgres://test',
        migrationsDir: '/tmp/__test-client-migrations',
      });

      await client.close();

      expect(result.ok).toBe(true);
    });
  });

  describe('readLedger()', () => {
    it('returns journal entries from the family instance', async () => {
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor, mockFamilyInstance } =
        createMockComponents();

      const expectedEntries: LedgerEntryRecord[] = [
        {
          space: 'app',
          migrationName: '001_init',
          migrationHash: 'mig-init',
          from: null,
          to: 'dest',
          appliedAt: new Date('2024-06-01T12:00:00.000Z'),
          operationCount: 1,
        },
        {
          space: 'audit',
          migrationName: '001_init',
          migrationHash: 'mig-audit',
          from: null,
          to: 'audit-dest',
          appliedAt: new Date('2024-06-01T12:00:01.000Z'),
          operationCount: 2,
        },
      ];
      let capturedSpace: string | undefined;
      mockFamilyInstance.readLedger = async (options) => {
        capturedSpace = options.space;
        return expectedEntries;
      };

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.connect('postgres://test');
      const entries = await client.readLedger();
      await client.close();

      expect(capturedSpace).toBeUndefined();
      expect(entries).toEqual(expectedEntries);
    });
  });

  describe('readMarker()', () => {
    it('returns null when no marker exists', async () => {
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.connect('postgres://test');
      const marker = await client.readMarker();
      await client.close();

      expect(marker).toBeNull();
    });

    it('returns marker record when marker exists', async () => {
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor, mockFamilyInstance } =
        createMockComponents();

      const expectedMarker = {
        storageHash: 'abc',
        profileHash: 'def',
        contractJson: null,
        canonicalVersion: 1,
        updatedAt: new Date(),
        appTag: null,
        meta: {},
        invariants: [],
      };
      mockFamilyInstance.readMarker = async () => expectedMarker;

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      await client.connect('postgres://test');
      const marker = await client.readMarker();
      await client.close();

      expect(marker).toEqual(expectedMarker);
    });
  });

  describe('inferPslContract()', () => {
    it('delegates to family instance when capability is implemented', () => {
      const fakeAst = { kind: 'document', namespaces: [] } as unknown;
      const { mockFamily, mockTarget, mockAdapter, mockFamilyInstance } = createMockComponents();
      (mockFamilyInstance as unknown as { inferPslContract: (ir: unknown) => unknown })[
        'inferPslContract'
      ] = (ir: unknown) => {
        void ir;
        return fakeAst;
      };

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
      });

      const result = client.inferPslContract({ tables: {} });
      expect(result).toBe(fakeAst);
    });

    it('returns undefined when family does not implement the capability', () => {
      const { mockFamily, mockTarget, mockAdapter } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
      });

      const result = client.inferPslContract({ tables: {} });
      expect(result).toBeUndefined();
    });
  });

  describe('toOperationPreview()', () => {
    it('delegates to family instance when capability is implemented', () => {
      const fakePreview = {
        statements: [{ text: 'CREATE TABLE x (id int)', language: 'sql' }],
      };
      const { mockFamily, mockTarget, mockAdapter, mockFamilyInstance } = createMockComponents();
      (
        mockFamilyInstance as unknown as {
          toOperationPreview: (ops: readonly unknown[]) => unknown;
        }
      )['toOperationPreview'] = (ops: readonly unknown[]) => {
        void ops;
        return fakePreview;
      };

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
      });

      const result = client.toOperationPreview([]);
      expect(result).toBe(fakePreview);
    });

    it('returns undefined when family does not implement the capability', () => {
      const { mockFamily, mockTarget, mockAdapter } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
      });

      expect(client.toOperationPreview([])).toBeUndefined();
    });
  });

  describe('no onProgress callback', () => {
    it('does not throw when onProgress is omitted from verify', async () => {
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      const result = await client.verify({
        contract: {},
        connection: 'postgres://test',
      });

      await client.close();

      expect(result.ok).toBe(true);
    });

    it('does not throw when onProgress is omitted from schemaVerify', async () => {
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      const result = await client.schemaVerify({
        contract: {},
        connection: 'postgres://test',
      });

      await client.close();

      expect(result.ok).toBe(true);
    });

    it('does not throw when onProgress is omitted from sign', async () => {
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      const result = await client.sign({
        contract: {},
        connection: 'postgres://test',
      });

      await client.close();

      expect(result.ok).toBe(true);
    });

    it('does not throw when onProgress is omitted from introspect', async () => {
      const { mockFamily, mockTarget, mockAdapter, mockDriverDescriptor } = createMockComponents();

      const client = createControlClient({
        family: mockFamily,
        target: mockTarget,
        adapter: mockAdapter,
        driver: mockDriverDescriptor,
      });

      const result = await client.introspect({
        connection: 'postgres://test',
      });

      await client.close();

      expect(result).toBeDefined();
    });

    it(
      'does not throw when onProgress is omitted from emit',
      async () => {
        const { mockFamily, mockTarget, mockAdapter } = createMockComponents();

        const client = createControlClient({
          family: mockFamily,
          target: mockTarget,
          adapter: mockAdapter,
        });

        const result = await client.emit({
          contractConfig: {
            source: createSourceProvider(),
            output: '/tmp/contract.json',
          },
        });

        await client.close();

        expect(result.ok).toBe(true);
      },
      timeouts.databaseOperation,
    );
  });
});
