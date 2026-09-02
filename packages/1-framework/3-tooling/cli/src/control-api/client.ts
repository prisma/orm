import type { Contract, ContractMarkerRecord, LedgerEntryRecord } from '@internal/contract/types';
import { emit as emitContractArtifacts } from '@internal/emitter';
import { CliStructuredError } from '@internal/errors/control';
import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlFamilyInstance,
  ControlStack,
  CoreSchemaView,
  MigrationPlanOperation,
  OperationPreview,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import {
  APP_SPACE_ID,
  createControlStack,
  hasMigrations,
  hasOperationPreview,
  hasPslContractInfer,
  hasSchemaView,
} from '@internal/framework-components/control';
import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok } from '@internal/utils/result';
import { structuredError } from '@internal/utils/structured-error';

import { assertFrameworkComponentsCompatible } from '../utils/framework-components';
import { enrichContract } from './contract-enrichment';
import { executeDbInit } from './operations/db-init';
import { executeDbUpdate } from './operations/db-update';
import { type ExecuteDbVerifyResult, executeDbVerify } from './operations/db-verify';
import { executeMigrate } from './operations/migrate';

import type {
  ControlActionName,
  ControlClient,
  ControlClientOptions,
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
  OnControlProgress,
  SchemaVerifyOptions,
  SignOptions,
  VerifyOptions,
} from './types';

/**
 * Creates a programmatic control client for Prisma ORM operations.
 *
 * The client accepts framework component descriptors at creation time,
 * manages driver lifecycle via connect()/close(), and exposes domain
 * operations that delegate to the existing family instance methods.
 *
 * @see {@link ControlClient} for the client interface
 * @see README.md "Programmatic Control API" section for usage examples
 */
export function createControlClient(options: ControlClientOptions): ControlClient {
  return new ControlClientImpl(options);
}

/**
 * Implementation of ControlClient.
 * Manages initialization and connection state, delegates operations to family instance.
 */
class ControlClientImpl implements ControlClient {
  private readonly options: ControlClientOptions;
  private stack: ControlStack | null = null;
  private driver: ControlDriverInstance<string, string> | null = null;
  private familyInstance: ControlFamilyInstance<string, unknown> | null = null;
  private frameworkComponents: ReadonlyArray<
    TargetBoundComponentDescriptor<string, string>
  > | null = null;
  private initialized = false;
  private readonly defaultConnection: unknown;

  constructor(options: ControlClientOptions) {
    this.options = options;
    this.defaultConnection = options.connection;
  }

  init(): void {
    if (this.initialized) {
      return; // Idempotent
    }

    this.stack = createControlStack({
      family: this.options.family,
      target: this.options.target,
      adapter: this.options.adapter,
      driver: this.options.driver,
      extensions: this.options.extensions,
    });

    this.familyInstance = this.options.family.create(this.stack);

    // Validate and type-narrow framework components
    const rawComponents = [
      this.options.target,
      this.options.adapter,
      ...(this.options.extensions ?? []),
    ];
    this.frameworkComponents = assertFrameworkComponentsCompatible(
      this.options.family.familyId,
      this.options.target.targetId,
      rawComponents,
    );

    this.initialized = true;
  }

  async connect(connection?: unknown): Promise<void> {
    // Auto-init if needed
    this.init();

    if (this.driver) {
      throw new CliStructuredError(
        'DRIVER.ALREADY_CONNECTED',
        'Already connected. Call close() before reconnecting.',
      );
    }

    // Resolve connection: argument > default from options
    const resolvedConnection = connection ?? this.defaultConnection;
    if (resolvedConnection === undefined) {
      throw new CliStructuredError(
        'CONFIG.DB_CONNECTION_REQUIRED',
        'No connection provided. Pass a connection to connect() or provide a default connection when creating the client.',
      );
    }

    // Check for driver descriptor
    if (!this.stack?.driver) {
      throw new CliStructuredError(
        'CONFIG.DRIVER_REQUIRED',
        'Driver is not configured. Pass a driver descriptor when creating the control client to enable database operations.',
      );
    }

    // biome-ignore lint/suspicious/noExplicitAny: required for runtime connection type flexibility
    this.driver = await this.stack.driver.create(resolvedConnection as any);
  }

  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
  }

  /**
   * Construct the control adapter once for a migration operation and return
   * it, mirroring how the runtime plane builds the execution adapter once in
   * `createExecutionStack`. Only `dbInit` / `dbUpdate` need it (it lowers the
   * planner's DDL); read-only operations never build it. The descriptor is
   * optional on the stack — targets without migrations omit it.
   */
  private buildControlAdapter(): ControlAdapterInstance<string, string> {
    this.init();
    if (!this.stack?.adapter) {
      throw new CliStructuredError(
        'MIGRATION.TARGET_UNSUPPORTED',
        `Target "${this.options.target.targetId}" requires an adapter for migrations`,
      );
    }
    return this.stack.adapter.create(this.stack);
  }

  private async ensureConnected(): Promise<{
    driver: ControlDriverInstance<string, string>;
    familyInstance: ControlFamilyInstance<string, unknown>;
    frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<string, string>>;
  }> {
    // Auto-init if needed
    this.init();

    // Auto-connect if not connected and default connection is available
    if (!this.driver && this.defaultConnection !== undefined) {
      await this.connect(this.defaultConnection);
    }

    if (!this.driver || !this.familyInstance || !this.frameworkComponents) {
      throw new CliStructuredError(
        'DRIVER.NOT_CONNECTED',
        'Not connected. Call connect(connection) first.',
      );
    }
    return {
      driver: this.driver,
      familyInstance: this.familyInstance,
      frameworkComponents: this.frameworkComponents,
    };
  }

  private async connectWithProgress(
    connection: unknown | undefined,
    action: ControlActionName,
    onProgress?: OnControlProgress,
  ): Promise<void> {
    if (connection === undefined) return;
    onProgress?.({
      action,
      kind: 'spanStart',
      spanId: 'connect',
      label: 'Connecting to database...',
    });
    try {
      await this.connect(connection);
      onProgress?.({ action, kind: 'spanEnd', spanId: 'connect', outcome: 'ok' });
    } catch (error) {
      onProgress?.({ action, kind: 'spanEnd', spanId: 'connect', outcome: 'error' });
      throw error;
    }
  }

  async verify(options: VerifyOptions): Promise<VerifyDatabaseResult> {
    const { onProgress } = options;
    await this.connectWithProgress(options.connection, 'verify', onProgress);
    const { driver, familyInstance } = await this.ensureConnected();

    // Validate contract using family instance
    let contract: Contract;
    try {
      contract = familyInstance.deserializeContract(options.contract);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw structuredError('CONTRACT.VALIDATION_FAILED', message, { cause: error });
    }

    // Emit verify span
    onProgress?.({
      action: 'verify',
      kind: 'spanStart',
      spanId: 'verify',
      label: 'Verifying database marker...',
    });

    try {
      // Delegate to family instance verify method
      // Note: We pass empty strings for contractPath/configPath since the programmatic
      // API doesn't deal with file paths. The family instance accepts these as optional
      // metadata for error reporting.
      const result = await familyInstance.verify({
        driver,
        contract,
        expectedTargetId: this.options.target.targetId,
        contractPath: '',
      });

      onProgress?.({
        action: 'verify',
        kind: 'spanEnd',
        spanId: 'verify',
        outcome: result.ok ? 'ok' : 'error',
      });

      return result;
    } catch (error) {
      onProgress?.({
        action: 'verify',
        kind: 'spanEnd',
        spanId: 'verify',
        outcome: 'error',
      });
      throw error;
    }
  }

  async schemaVerify(options: SchemaVerifyOptions): Promise<VerifyDatabaseSchemaResult> {
    const { onProgress } = options;
    await this.connectWithProgress(options.connection, 'schemaVerify', onProgress);
    const { driver, familyInstance, frameworkComponents } = await this.ensureConnected();

    // Validate contract using family instance
    let contract: Contract;
    try {
      contract = familyInstance.deserializeContract(options.contract);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw structuredError('CONTRACT.VALIDATION_FAILED', message, { cause: error });
    }

    // Emit schemaVerify span
    onProgress?.({
      action: 'schemaVerify',
      kind: 'spanStart',
      spanId: 'schemaVerify',
      label: 'Verifying database schema...',
    });

    try {
      // Introspect the live schema, then verify the contract against
      // it. Composing the two primitives here keeps the family
      // interface a single synchronous verifier and gives callers
      // (and tests) explicit control over the introspected schema.
      const schema = await familyInstance.introspect({ driver, contract });
      const result = familyInstance.verifySchema({
        contract,
        schema,
        strict: options.strict ?? false,
        frameworkComponents,
      });

      onProgress?.({
        action: 'schemaVerify',
        kind: 'spanEnd',
        spanId: 'schemaVerify',
        outcome: result.ok ? 'ok' : 'error',
      });

      return result;
    } catch (error) {
      onProgress?.({
        action: 'schemaVerify',
        kind: 'spanEnd',
        spanId: 'schemaVerify',
        outcome: 'error',
      });
      throw error;
    }
  }

  async sign(options: SignOptions): Promise<SignDatabaseResult> {
    const { onProgress } = options;
    await this.connectWithProgress(options.connection, 'sign', onProgress);
    const { driver, familyInstance } = await this.ensureConnected();

    // Validate contract using family instance
    let contract: Contract;
    try {
      contract = familyInstance.deserializeContract(options.contract);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw structuredError('CONTRACT.VALIDATION_FAILED', message, { cause: error });
    }

    // Emit sign span
    onProgress?.({
      action: 'sign',
      kind: 'spanStart',
      spanId: 'sign',
      label: 'Signing database...',
    });

    try {
      // Delegate to family instance sign method
      const result = await familyInstance.sign({
        driver,
        contract,
        contractPath: options.contractPath ?? '',
        ...ifDefined('configPath', options.configPath),
      });

      onProgress?.({
        action: 'sign',
        kind: 'spanEnd',
        spanId: 'sign',
        outcome: 'ok',
      });

      return result;
    } catch (error) {
      onProgress?.({
        action: 'sign',
        kind: 'spanEnd',
        spanId: 'sign',
        outcome: 'error',
      });
      throw error;
    }
  }

  async dbInit(options: DbInitOptions): Promise<DbInitResult> {
    const { onProgress } = options;
    await this.connectWithProgress(options.connection, 'dbInit', onProgress);
    const { driver, familyInstance, frameworkComponents } = await this.ensureConnected();

    if (!hasMigrations(this.options.target)) {
      throw new CliStructuredError(
        'MIGRATION.TARGET_UNSUPPORTED',
        `Target "${this.options.target.targetId}" does not support migrations`,
      );
    }

    const adapter = this.buildControlAdapter();

    let contract: Contract;
    try {
      contract = familyInstance.deserializeContract(options.contract);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw structuredError('CONTRACT.VALIDATION_FAILED', message, { cause: error });
    }

    return executeDbInit({
      driver,
      adapter,
      familyInstance,
      contract,
      mode: options.mode,
      migrations: this.options.target.migrations,
      frameworkComponents,
      migrationsDir: options.migrationsDir,
      targetId: this.options.target.targetId,
      extensions: this.options.extensions ?? [],
      ...ifDefined('onProgress', onProgress),
    });
  }

  async dbUpdate(options: DbUpdateOptions): Promise<DbUpdateResult> {
    const { onProgress } = options;
    await this.connectWithProgress(options.connection, 'dbUpdate', onProgress);
    const { driver, familyInstance, frameworkComponents } = await this.ensureConnected();

    if (!hasMigrations(this.options.target)) {
      throw new CliStructuredError(
        'MIGRATION.TARGET_UNSUPPORTED',
        `Target "${this.options.target.targetId}" does not support migrations`,
      );
    }

    const adapter = this.buildControlAdapter();

    let contract: Contract;
    try {
      contract = familyInstance.deserializeContract(options.contract);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw structuredError('CONTRACT.VALIDATION_FAILED', message, { cause: error });
    }

    return executeDbUpdate({
      driver,
      adapter,
      familyInstance,
      contract,
      mode: options.mode,
      migrations: this.options.target.migrations,
      frameworkComponents,
      migrationsDir: options.migrationsDir,
      targetId: this.options.target.targetId,
      extensions: this.options.extensions ?? [],
      ...ifDefined('acceptDataLoss', options.acceptDataLoss),
      ...ifDefined('consent', options.consent),
      ...ifDefined('onProgress', onProgress),
    });
  }

  async dbVerify(options: DbVerifyOptions): Promise<ExecuteDbVerifyResult> {
    const { onProgress } = options;
    await this.connectWithProgress(options.connection, 'dbVerify', onProgress);
    const { driver, familyInstance, frameworkComponents } = await this.ensureConnected();

    return executeDbVerify({
      driver,
      familyInstance,
      contract: options.contract,
      migrationsDir: options.migrationsDir,
      targetId: this.options.target.targetId,
      extensions: this.options.extensions ?? [],
      frameworkComponents,
      mode: options.strict ? 'strict' : 'lenient',
      skipSchema: options.skipSchema,
      skipMarker: options.skipMarker,
      ...ifDefined('onProgress', onProgress),
    });
  }

  async readMarker(): Promise<ContractMarkerRecord | null> {
    const { driver, familyInstance } = await this.ensureConnected();
    // The CLI client's readMarker reads the app's marker. Per-extension
    // readers go through the orchestrator's per-space planner / runner
    // boundary, which threads the extension's space id through the
    // family interface explicitly.
    return familyInstance.readMarker({ driver, space: APP_SPACE_ID });
  }

  async readAllMarkers(): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    const { driver, familyInstance } = await this.ensureConnected();
    return familyInstance.readAllMarkers({ driver });
  }

  /** Reads the per-migration journal; omit `space` to return every space. */
  async readLedger(space?: string): Promise<readonly LedgerEntryRecord[]> {
    const { driver, familyInstance } = await this.ensureConnected();
    return familyInstance.readLedger({ driver, ...ifDefined('space', space) });
  }

  async migrate(options: MigrateOptions): Promise<MigrateResult> {
    const { onProgress } = options;
    await this.connectWithProgress(options.connection, 'migrate', onProgress);
    const { driver, familyInstance, frameworkComponents } = await this.ensureConnected();

    if (!hasMigrations(this.options.target)) {
      throw new CliStructuredError(
        'MIGRATION.TARGET_UNSUPPORTED',
        `Target "${this.options.target.targetId}" does not support migrations`,
      );
    }

    let contract: Contract;
    try {
      contract = familyInstance.deserializeContract(options.contract);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw structuredError('CONTRACT.VALIDATION_FAILED', message, { cause: error });
    }

    return executeMigrate({
      driver,
      familyInstance,
      contract,
      migrations: this.options.target.migrations,
      frameworkComponents,
      migrationsDir: options.migrationsDir,
      extensions: this.options.extensions ?? [],
      targetId: this.options.target.targetId,
      ...ifDefined('refHash', options.refHash),
      ...ifDefined('refInvariants', options.refInvariants),
      ...ifDefined('refName', options.refName),
      ...ifDefined('onProgress', onProgress),
    });
  }

  async introspect(options?: IntrospectOptions): Promise<unknown> {
    const onProgress = options?.onProgress;
    await this.connectWithProgress(options?.connection, 'introspect', onProgress);
    const { driver, familyInstance } = await this.ensureConnected();

    // Emit introspect span
    onProgress?.({
      action: 'introspect',
      kind: 'spanStart',
      spanId: 'introspect',
      label: 'Introspecting database schema...',
    });

    try {
      const result = await familyInstance.introspect({
        driver,
        ...ifDefined('schema', options?.schema),
      });

      onProgress?.({
        action: 'introspect',
        kind: 'spanEnd',
        spanId: 'introspect',
        outcome: 'ok',
      });

      return result;
    } catch (error) {
      onProgress?.({
        action: 'introspect',
        kind: 'spanEnd',
        spanId: 'introspect',
        outcome: 'error',
      });
      throw error;
    }
  }

  toSchemaView(schemaIR: unknown): CoreSchemaView | undefined {
    this.init();
    if (this.familyInstance && hasSchemaView(this.familyInstance)) {
      return this.familyInstance.toSchemaView(schemaIR);
    }
    return undefined;
  }

  inferPslContract(schemaIR: unknown): PslDocumentAst | undefined {
    this.init();
    if (this.familyInstance && hasPslContractInfer(this.familyInstance)) {
      return this.familyInstance.inferPslContract(schemaIR);
    }
    return undefined;
  }

  getPslBlockDescriptors(): AuthoringPslBlockDescriptorNamespace {
    this.init();
    return this.stack!.authoringContributions.pslBlockDescriptors;
  }

  toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview | undefined {
    this.init();
    if (this.familyInstance && hasOperationPreview(this.familyInstance)) {
      return this.familyInstance.toOperationPreview(operations);
    }
    return undefined;
  }

  async emit(options: EmitOptions): Promise<EmitResult> {
    const { onProgress, contractConfig } = options;

    // Ensure initialized (creates stack and family instance)
    // emit() does NOT require a database connection
    this.init();

    if (!this.familyInstance) {
      throw new InternalError('Family instance was not initialized. This is a bug.');
    }

    let contractRaw: unknown;
    onProgress?.({
      action: 'emit',
      kind: 'spanStart',
      spanId: 'resolveSource',
      label: 'Resolving contract source...',
    });

    try {
      const stack = this.stack!;
      const sourceContext = {
        composedExtensions: stack.extensions.map((p) => p.id),
        composedExtensionContracts: stack.extensionContracts,
        authoringContributions: stack.authoringContributions,
        codecLookup: stack.codecLookup,
        controlMutationDefaults: stack.controlMutationDefaults,
        resolvedInputs: contractConfig.source.inputs ?? [],
        capabilities: stack.capabilities,
      };
      const providerResult = await contractConfig.source.load(sourceContext);
      if (!providerResult.ok) {
        onProgress?.({
          action: 'emit',
          kind: 'spanEnd',
          spanId: 'resolveSource',
          outcome: 'error',
        });

        return notOk({
          code: 'CONTRACT_SOURCE_INVALID',
          summary: providerResult.failure.summary,
          why: providerResult.failure.summary,
          meta: providerResult.failure.meta,
          diagnostics: providerResult.failure,
        });
      }
      contractRaw = providerResult.value;

      onProgress?.({
        action: 'emit',
        kind: 'spanEnd',
        spanId: 'resolveSource',
        outcome: 'ok',
      });
    } catch (error) {
      onProgress?.({
        action: 'emit',
        kind: 'spanEnd',
        spanId: 'resolveSource',
        outcome: 'error',
      });

      const message = error instanceof Error ? error.message : String(error);
      return notOk({
        code: 'CONTRACT_SOURCE_INVALID',
        summary: 'Failed to resolve contract source',
        why: message,
        diagnostics: {
          summary: 'Contract source provider threw an exception',
          diagnostics: [
            {
              code: 'PROVIDER_THROW',
              message,
            },
          ],
        },
        meta: undefined,
      });
    }

    // Emit contract
    onProgress?.({
      action: 'emit',
      kind: 'spanStart',
      spanId: 'emit',
      label: 'Emitting contract...',
    });

    try {
      // Blind cast: `contractRaw` is the unverified provider
      // payload — `enrichContract` only adds capability + extension
      // metadata onto whatever shape it receives. The structural
      // check happens immediately afterwards via
      // `familyInstance.deserializeContract`, which is the
      // seam-of-record and the only thing that may surface
      // structural errors to the caller.
      const enrichedIR = enrichContract(
        contractRaw as unknown as Contract,
        this.frameworkComponents ?? [],
      );
      const rawContractJson = this.options.target.contractSerializer.serializeContract(enrichedIR);

      let deserializedContract: Contract;
      try {
        deserializedContract = this.familyInstance.deserializeContract(rawContractJson);
      } catch (error) {
        onProgress?.({
          action: 'emit',
          kind: 'spanEnd',
          spanId: 'emit',
          outcome: 'error',
        });
        const message = error instanceof Error ? error.message : String(error);
        return notOk({
          code: 'CONTRACT_VALIDATION_FAILED',
          summary: 'Contract validation failed',
          why: message,
          meta: undefined,
        });
      }

      const result = await emitContractArtifacts(
        deserializedContract,
        this.stack!,
        this.options.family.emission,
        {
          serializeContract: (contract) =>
            this.options.target.contractSerializer.serializeContract(contract),
        },
      );

      onProgress?.({
        action: 'emit',
        kind: 'spanEnd',
        spanId: 'emit',
        outcome: 'ok',
      });

      return ok({
        storageHash: result.storageHash,
        ...ifDefined('executionHash', result.executionHash),
        profileHash: result.profileHash,
        contractJson: result.contractJson,
        contractDts: result.contractDts,
      });
    } catch (error) {
      onProgress?.({
        action: 'emit',
        kind: 'spanEnd',
        spanId: 'emit',
        outcome: 'error',
      });

      return notOk({
        code: 'EMIT_FAILED',
        summary: 'Failed to emit contract',
        why: error instanceof Error ? error.message : String(error),
        meta: undefined,
      });
    }
  }
}
