import type { ContractMarkerRecord, LedgerEntryRecord } from '@internal/contract/types';
import { CliStructuredError } from '@internal/errors/control';
import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type {
  CoreSchemaView,
  MigrationPlanOperation,
  OperationPreview,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import { ok } from '@internal/utils/result';
import type { ExecuteDbVerifyResult } from '../operations/db-verify';
import type { RenderContractDtsOptions, RenderContractDtsResult } from '../render-contract-dts';
import type {
  ControlClient,
  DbInitOptions,
  DbInitResult,
  DbUpdateOptions,
  DbUpdateResult,
  DbVerifyOptions,
  EmitOptions,
  EmitResult,
  IntrospectOptions,
  MigrateOptions,
  MigrateResult,
  SchemaVerifyOptions,
  SignOptions,
  VerifyOptions,
} from '../types';

export const FIXTURE_STORAGE_HASH =
  '7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26';
export const FIXTURE_PROFILE_HASH =
  '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae';
export const FIXTURE_MIGRATION_HASH =
  'fcde2b2edba56bf408601fb721fe9b5c338d10ee429ea04fae5511b68fbf8fb9';

const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00.000Z';

/** Target id the default fixtures report; overridable per test. */
export const FIXTURE_TARGET_ID = 'fixture-target';

/** Family id the default fixtures report in emitted contract payloads. */
export const FIXTURE_FAMILY_ID = 'fixture-family';

/**
 * The value each {@link ControlClient} operation resolves to. Every key can be
 * replaced per test via `createFixtureControlClient(overrides)`.
 */
export interface ControlClientFixtures {
  readonly verify: VerifyDatabaseResult;
  readonly schemaVerify: VerifyDatabaseSchemaResult;
  readonly sign: SignDatabaseResult;
  readonly dbInit: DbInitResult;
  readonly dbUpdate: DbUpdateResult;
  readonly dbVerify: ExecuteDbVerifyResult;
  readonly readMarker: ContractMarkerRecord | null;
  readonly readAllMarkers: ReadonlyMap<string, ContractMarkerRecord>;
  readonly readLedger: readonly LedgerEntryRecord[];
  readonly migrate: MigrateResult;
  readonly introspect: unknown;
  readonly toSchemaView: CoreSchemaView | undefined;
  readonly inferPslContract: PslDocumentAst | undefined;
  readonly getPslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly toOperationPreview: OperationPreview | undefined;
  readonly emit: EmitResult;
  readonly renderContractDts: RenderContractDtsResult;
}

export interface FixtureControlClientCall {
  readonly operation: string;
  readonly options: unknown;
}

/**
 * A {@link ControlClient} test double. Behaves like the real client's surface
 * but resolves every operation from fixtures instead of a database, and
 * records each call for assertions. Operations the real client runs against a
 * driver reject with `DRIVER.NOT_CONNECTED` until `connect()` is awaited.
 */
export interface FixtureControlClient extends ControlClient {
  /** Every operation invocation in order, with the options it received. */
  readonly calls: readonly FixtureControlClientCall[];
  /** Connection state as driven by `connect()` / `close()`. */
  readonly connected: boolean;
}

const fixtureOperation = {
  id: 'op-1',
  label: 'create User',
  operationClass: 'additive',
} as const;

function fixtureMarker(): ContractMarkerRecord {
  return {
    storageHash: FIXTURE_STORAGE_HASH,
    profileHash: FIXTURE_PROFILE_HASH,
    contractJson: null,
    canonicalVersion: 1,
    updatedAt: new Date(FIXTURE_TIMESTAMP),
    appTag: null,
    meta: {},
    invariants: [],
  };
}

/**
 * Target-neutral defaults for every operation: a healthy database whose
 * marker, ledger, and schema all match the fixture contract.
 */
export function defaultControlClientFixtures(): ControlClientFixtures {
  const contract = { storageHash: FIXTURE_STORAGE_HASH, profileHash: FIXTURE_PROFILE_HASH };
  const target = { expected: FIXTURE_TARGET_ID, actual: FIXTURE_TARGET_ID };
  const schemaVerify: VerifyDatabaseSchemaResult = {
    ok: true,
    summary: 'Schema satisfies contract',
    contract,
    target,
    schema: { issues: [] },
    timings: { total: 5 },
  };
  const applySuccess = {
    mode: 'apply' as const,
    plan: { operations: [fixtureOperation] },
    destination: contract,
    execution: { operationsPlanned: 1, operationsExecuted: 1 },
    marker: contract,
    perSpace: [
      {
        spaceId: APP_SPACE_ID,
        kind: 'app' as const,
        operations: [fixtureOperation],
        marker: { storageHash: FIXTURE_STORAGE_HASH },
      },
    ],
    summary: 'Applied 1 operation',
  };

  return {
    verify: {
      ok: true,
      summary: 'Database matches contract',
      contract,
      marker: contract,
      target,
      timings: { total: 5 },
    },
    schemaVerify,
    sign: {
      ok: true,
      summary: 'Signature written',
      contract,
      target,
      marker: { created: true, updated: false },
      timings: { total: 5 },
    },
    dbInit: ok(applySuccess),
    dbUpdate: ok(applySuccess),
    dbVerify: ok({
      schemaResults: new Map([[APP_SPACE_ID, schemaVerify]]),
      unclaimed: [],
      spaceOrder: [APP_SPACE_ID],
      appSpaceId: APP_SPACE_ID,
      markerDrift: null,
    }),
    readMarker: fixtureMarker(),
    readAllMarkers: new Map([[APP_SPACE_ID, fixtureMarker()]]),
    readLedger: [
      {
        space: APP_SPACE_ID,
        migrationName: '20260101000000_init',
        migrationHash: FIXTURE_MIGRATION_HASH,
        from: null,
        to: FIXTURE_STORAGE_HASH,
        appliedAt: new Date(FIXTURE_TIMESTAMP),
        operationCount: 1,
      },
    ],
    migrate: ok({
      migrationsApplied: 1,
      markerHash: FIXTURE_STORAGE_HASH,
      applied: [
        {
          spaceId: APP_SPACE_ID,
          dirName: '20260101000000_init',
          migrationHash: FIXTURE_MIGRATION_HASH,
          from: FIXTURE_PROFILE_HASH,
          to: FIXTURE_STORAGE_HASH,
          operationsExecuted: 1,
        },
      ],
      summary: 'Applied 1 migration',
      perSpace: [
        {
          spaceId: APP_SPACE_ID,
          kind: 'app' as const,
          operations: [fixtureOperation],
          marker: { storageHash: FIXTURE_STORAGE_HASH },
        },
      ],
    }),
    introspect: {},
    toSchemaView: undefined,
    inferPslContract: undefined,
    getPslBlockDescriptors: {},
    toOperationPreview: undefined,
    emit: ok({
      storageHash: FIXTURE_STORAGE_HASH,
      profileHash: FIXTURE_PROFILE_HASH,
      contractJson: `{"targetFamily":"${FIXTURE_FAMILY_ID}"}`,
      contractDts: `export type Contract = { targetFamily: "${FIXTURE_FAMILY_ID}" };`,
    }),
    renderContractDts: ok({
      contractDts: `export type Contract = { targetFamily: "${FIXTURE_FAMILY_ID}" };`,
    }),
  };
}

class FixtureControlClientImpl implements FixtureControlClient {
  readonly calls: FixtureControlClientCall[] = [];
  connected = false;

  private initialized = false;
  private readonly fixtures: ControlClientFixtures;

  constructor(overrides?: Partial<ControlClientFixtures>) {
    this.fixtures = { ...defaultControlClientFixtures(), ...overrides };
  }

  private record<T>(operation: string, options: unknown, value: T): T {
    this.init();
    this.calls.push({ operation, options });
    return value;
  }

  /**
   * Records an operation the real client runs against a driver, so a caller
   * that skipped `connect()` fails here exactly as it would in production.
   */
  private recordConnected<T>(operation: string, options: unknown, value: T): T {
    const supplied: unknown =
      typeof options === 'object' && options !== null
        ? Reflect.get(options, 'connection')
        : undefined;
    if (supplied !== undefined) {
      this.markConnected(supplied);
    }
    if (!this.connected) {
      throw new CliStructuredError(
        'DRIVER.NOT_CONNECTED',
        'Not connected. Call connect(connection) first.',
      );
    }
    return this.record(operation, options, value);
  }

  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    this.calls.push({ operation: 'init', options: undefined });
  }

  private markConnected(connection: unknown): void {
    this.init();
    this.calls.push({ operation: 'connect', options: connection });
    this.connected = true;
  }

  async connect(connection?: unknown): Promise<void> {
    this.markConnected(connection);
  }

  async close(): Promise<void> {
    this.calls.push({ operation: 'close', options: undefined });
    this.connected = false;
  }

  async verify(options: VerifyOptions): Promise<VerifyDatabaseResult> {
    return this.recordConnected('verify', options, this.fixtures.verify);
  }

  async schemaVerify(options: SchemaVerifyOptions): Promise<VerifyDatabaseSchemaResult> {
    return this.recordConnected('schemaVerify', options, this.fixtures.schemaVerify);
  }

  async sign(options: SignOptions): Promise<SignDatabaseResult> {
    return this.recordConnected('sign', options, this.fixtures.sign);
  }

  async dbInit(options: DbInitOptions): Promise<DbInitResult> {
    return this.recordConnected('dbInit', options, this.fixtures.dbInit);
  }

  async dbUpdate(options: DbUpdateOptions): Promise<DbUpdateResult> {
    return this.recordConnected('dbUpdate', options, this.fixtures.dbUpdate);
  }

  async dbVerify(options: DbVerifyOptions): Promise<ExecuteDbVerifyResult> {
    return this.recordConnected('dbVerify', options, this.fixtures.dbVerify);
  }

  async readMarker(): Promise<ContractMarkerRecord | null> {
    return this.recordConnected('readMarker', undefined, this.fixtures.readMarker);
  }

  async readAllMarkers(): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    return this.recordConnected('readAllMarkers', undefined, this.fixtures.readAllMarkers);
  }

  async readLedger(space?: string): Promise<readonly LedgerEntryRecord[]> {
    return this.recordConnected('readLedger', space, this.fixtures.readLedger);
  }

  async migrate(options: MigrateOptions): Promise<MigrateResult> {
    return this.recordConnected('migrate', options, this.fixtures.migrate);
  }

  async introspect(options?: IntrospectOptions): Promise<unknown> {
    return this.recordConnected('introspect', options, this.fixtures.introspect);
  }

  toSchemaView(schemaIR: unknown): CoreSchemaView | undefined {
    return this.record('toSchemaView', schemaIR, this.fixtures.toSchemaView);
  }

  inferPslContract(schemaIR: unknown): PslDocumentAst | undefined {
    return this.record('inferPslContract', schemaIR, this.fixtures.inferPslContract);
  }

  getPslBlockDescriptors(): AuthoringPslBlockDescriptorNamespace {
    return this.record('getPslBlockDescriptors', undefined, this.fixtures.getPslBlockDescriptors);
  }

  toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview | undefined {
    return this.record('toOperationPreview', operations, this.fixtures.toOperationPreview);
  }

  async emit(options: EmitOptions): Promise<EmitResult> {
    return this.record('emit', options, this.fixtures.emit);
  }

  async renderContractDts(options: RenderContractDtsOptions): Promise<RenderContractDtsResult> {
    return this.record('renderContractDts', options, this.fixtures.renderContractDts);
  }
}

/**
 * Creates a fixture-backed {@link ControlClient} double for host and product
 * tests: every operation resolves a realistic fixture payload without a
 * database or driver, and each fixture is overridable per test.
 */
export function createFixtureControlClient(
  overrides?: Partial<ControlClientFixtures>,
): FixtureControlClient {
  return new FixtureControlClientImpl(overrides);
}
