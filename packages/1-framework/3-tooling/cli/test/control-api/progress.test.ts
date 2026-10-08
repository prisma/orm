import type { Contract } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlFamilyInstance,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { ok } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import { executeDbInit } from '../../src/control-api/operations/db-init';
import type { ControlProgressEvent } from '../../src/control-api/types';

const FAKE_MIGRATIONS_DIR = '/tmp/__test-db-init-progress';

describe('executeDbInit progress emission', () => {
  it('emits expected span events in plan mode', async () => {
    const events: ControlProgressEvent[] = [];

    const mockDriver = {
      close: async () => {},
    } as unknown as ControlDriverInstance<string, string>;

    const mockFamilyInstance = {
      introspect: async () => ({}),
      deserializeContract: () => ({}) as Contract,
      readAllMarkers: async () => new Map(),
    } as unknown as ControlFamilyInstance<string, unknown>;

    const mockMigrations = {
      createPlanner: () => ({
        plan: async () => ({
          kind: 'success' as const,
          appliedStatements: [],
          plan: {
            targetId: 'postgres',
            destination: { storageHash: 'test-hash' },
            operations: [],
          },
        }),
      }),
      createRunner: () => ({
        execute: async () =>
          ok({
            perSpaceResults: [
              { space: 'app', value: { operationsPlanned: 0, operationsExecuted: 0 } },
            ],
          }),
      }),
    } as unknown as TargetMigrationsCapability<
      string,
      string,
      ControlFamilyInstance<string, unknown>
    >;

    const mockFrameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<string, string>> =
      [];

    await executeDbInit({
      driver: mockDriver,
      adapter: {} as unknown as ControlAdapterInstance<string, string>,
      familyInstance: mockFamilyInstance,
      contract: {
        target: 'postgres',
        storage: { storageHash: 'fixture', tables: {}, namespaces: {} },
      } as unknown as Contract,
      mode: 'plan',
      migrations: mockMigrations,
      frameworkComponents: mockFrameworkComponents,
      migrationsDir: FAKE_MIGRATIONS_DIR,
      targetId: 'postgres',
      onProgress: (event) => {
        events.push(event);
      },
    });

    expect(events.length).toBeGreaterThan(0);

    const spanStarts = events.filter((e) => e.kind === 'spanStart');
    const spanEnds = events.filter((e) => e.kind === 'spanEnd');

    expect(spanStarts.length).toBeGreaterThan(0);
    expect(spanEnds.length).toBe(spanStarts.length);

    const introspectSpan = spanStarts.find((e) => e.spanId === 'introspect');
    const planSpan = spanStarts.find((e) => e.spanId === 'plan');

    expect(introspectSpan).toBeDefined();
    expect(planSpan).toBeDefined();

    // Plan-mode never enters the apply phase.
    const applySpan = spanStarts.find((e) => e.spanId === 'apply');
    expect(applySpan).toBeUndefined();
  });

  it('emits an apply span in apply mode', async () => {
    const events: ControlProgressEvent[] = [];

    const mockDriver = {
      close: async () => {},
    } as unknown as ControlDriverInstance<string, string>;

    const mockFamilyInstance = {
      introspect: async () => ({}),
      deserializeContract: () => ({}) as Contract,
      readAllMarkers: async () => new Map(),
    } as unknown as ControlFamilyInstance<string, unknown>;

    const mockOperations = [
      { id: 'op-1', label: 'Create table users', operationClass: 'additive' },
      { id: 'op-2', label: 'Create index idx_users_email', operationClass: 'additive' },
    ];

    const mockMigrations = {
      createPlanner: () => ({
        plan: async () => ({
          kind: 'success' as const,
          appliedStatements: [],
          plan: {
            targetId: 'postgres',
            destination: { storageHash: 'test-hash' },
            operations: mockOperations,
          },
        }),
      }),
      createRunner: () => ({
        execute: async () =>
          ok({
            perSpaceResults: [
              {
                space: 'app',
                value: { operationsPlanned: 2, operationsExecuted: 2 },
              },
            ],
          }),
      }),
    } as unknown as TargetMigrationsCapability<
      string,
      string,
      ControlFamilyInstance<string, unknown>
    >;

    const mockFrameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<string, string>> =
      [];

    await executeDbInit({
      driver: mockDriver,
      adapter: {} as unknown as ControlAdapterInstance<string, string>,
      familyInstance: mockFamilyInstance,
      contract: {
        target: 'postgres',
        storage: { storageHash: 'fixture', tables: {}, namespaces: {} },
      } as unknown as Contract,
      mode: 'apply',
      migrations: mockMigrations,
      frameworkComponents: mockFrameworkComponents,
      migrationsDir: FAKE_MIGRATIONS_DIR,
      targetId: 'postgres',
      onProgress: (event) => {
        events.push(event);
      },
    });

    const applySpanStart = events.find((e) => e.kind === 'spanStart' && e.spanId === 'apply');
    expect(applySpanStart).toBeDefined();
    expect(applySpanStart).toMatchObject({
      action: 'dbInit',
      label: 'Initialising database across spaces',
    });

    const applySpanEnd = events.find((e) => e.kind === 'spanEnd' && e.spanId === 'apply');
    expect(applySpanEnd).toMatchObject({ outcome: 'ok' });
  });

  it('emits no events when onProgress is omitted', async () => {
    const mockDriver = {
      close: async () => {},
    } as unknown as ControlDriverInstance<string, string>;

    const mockFamilyInstance = {
      introspect: async () => ({}),
      deserializeContract: () => ({}) as Contract,
      readAllMarkers: async () => new Map(),
    } as unknown as ControlFamilyInstance<string, unknown>;

    const mockMigrations = {
      createPlanner: () => ({
        plan: async () => ({
          kind: 'success' as const,
          appliedStatements: [],
          plan: {
            targetId: 'postgres',
            destination: { storageHash: 'test-hash' },
            operations: [],
          },
        }),
      }),
      createRunner: () => ({
        execute: async () =>
          ok({
            perSpaceResults: [
              { space: 'app', value: { operationsPlanned: 0, operationsExecuted: 0 } },
            ],
          }),
      }),
    } as unknown as TargetMigrationsCapability<
      string,
      string,
      ControlFamilyInstance<string, unknown>
    >;

    const mockFrameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<string, string>> =
      [];

    const result = await executeDbInit({
      driver: mockDriver,
      adapter: {} as unknown as ControlAdapterInstance<string, string>,
      familyInstance: mockFamilyInstance,
      contract: {
        target: 'postgres',
        storage: { storageHash: 'fixture', tables: {}, namespaces: {} },
      } as unknown as Contract,
      mode: 'plan',
      migrations: mockMigrations,
      frameworkComponents: mockFrameworkComponents,
      migrationsDir: FAKE_MIGRATIONS_DIR,
      targetId: 'postgres',
    });

    expect(result.ok).toBe(true);
  });
});
