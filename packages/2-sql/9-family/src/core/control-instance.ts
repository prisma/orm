import type { Contract, ContractMarkerRecord, LedgerEntryRecord } from '@internal/contract/types';
import type {
  TargetBoundComponentDescriptor,
  TargetDescriptor,
} from '@internal/framework-components/components';
import type {
  ControlFamilyInstance,
  ControlStack,
  CoreSchemaView,
  DiffSubjectGranularity,
  MigrationPlanOperation,
  OperationPreview,
  OperationPreviewCapable,
  PslContractInferCapable,
  SchemaDiffIssue,
  SchemaViewCapable,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import {
  APP_SPACE_ID,
  SchemaTreeNode,
  VERIFY_CODE_HASH_MISMATCH,
  VERIFY_CODE_MARKER_MISSING,
  VERIFY_CODE_TARGET_MISMATCH,
} from '@internal/framework-components/control';
import type { TypesImportSpec } from '@internal/framework-components/emission';
import { isPlainRecord } from '@internal/framework-components/ir';
import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import { assertDescriptorSelfConsistency } from '@internal/migration-tools/spaces';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import type { SqlControlDriverInstance, SqlStorage } from '@internal/sql-contract/types';
import type {
  AnyQueryAst,
  DdlNode,
  LowererContext,
  SqlExecuteRequest,
} from '@internal/sql-relational-core/ast';
import type { SqlSchemaIRNode, SqlTableIR } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import type { StructuredError } from '@internal/utils/structured-error';
import type { SqlControlAdapter } from './control-adapter';
import type {
  SqlControlTargetDescriptor,
  SqlDescribedContractSpace,
} from './control-target-descriptor';
import {
  classifyDiffEntityKind,
  classifyDiffSubjectGranularity,
  verifySqlSchemaByDiff,
} from './diff/schema-verify';
import { sqlFamilyError } from './errors';
import { SqlContractSerializer } from './ir/sql-contract-serializer';
import type { SqlSchemaDiffFn } from './migrations/schema-differ';
import type {
  SqlControlAdapterDescriptor,
  SqlControlExtensionDescriptor,
} from './migrations/types';
import { sqlOperationsToPreview } from './operation-preview';
import { collectSupportedCodecTypeIds } from './verify';

function missingDescriptorOperationError(targetId: string, operation: string): StructuredError {
  return sqlFamilyError(
    'CONTRACT.PACK_CONTRIBUTION_INVALID',
    `SQL target "${targetId}" is missing the required ${operation} descriptor operation`,
    {
      why: `The target descriptor does not contribute the ${operation} operation the SQL family requires for this call.`,
      fix: `Use a target package whose control descriptor implements ${operation}.`,
      meta: { targetId, operation },
    },
  );
}

function extractCodecTypeIdsFromContract(contract: unknown): readonly string[] {
  const typeIds = new Set<string>();

  // Type guard for SQL contract structure
  if (
    typeof contract === 'object' &&
    contract !== null &&
    'storage' in contract &&
    typeof contract.storage === 'object' &&
    contract.storage !== null &&
    'namespaces' in contract.storage &&
    typeof contract.storage.namespaces === 'object' &&
    contract.storage.namespaces !== null
  ) {
    const namespaces = contract.storage.namespaces as Record<
      string,
      { readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>> }
    >;
    for (const ns of Object.values(namespaces)) {
      const tbls = ns.entries['table'];
      if (typeof tbls !== 'object' || tbls === null) continue;
      for (const table of Object.values(tbls)) {
        if (
          typeof table === 'object' &&
          table !== null &&
          'columns' in table &&
          typeof table.columns === 'object' &&
          table.columns !== null
        ) {
          const columns = table.columns as Record<string, { codecId: string } | undefined>;
          for (const column of Object.values(columns)) {
            if (
              column &&
              typeof column === 'object' &&
              'codecId' in column &&
              typeof column.codecId === 'string'
            ) {
              typeIds.add(column.codecId);
            }
          }
        }
      }
    }
  }

  return Array.from(typeIds).sort();
}

function createVerifyResult(options: {
  ok: boolean;
  code?: string;
  summary: string;
  contractStorageHash: string;
  contractProfileHash?: string;
  marker?: ContractMarkerRecord;
  expectedTargetId: string;
  actualTargetId?: string;
  missingCodecs?: readonly string[];
  codecCoverageSkipped?: boolean;
  configPath?: string;
  contractPath: string;
  totalTime: number;
}): VerifyDatabaseResult {
  const contract: { storageHash: string; profileHash?: string } = {
    storageHash: options.contractStorageHash,
  };
  if (options.contractProfileHash) {
    contract.profileHash = options.contractProfileHash;
  }

  const target: { expected: string; actual?: string } = {
    expected: options.expectedTargetId,
  };
  if (options.actualTargetId) {
    target.actual = options.actualTargetId;
  }

  const meta: { contractPath: string; configPath?: string } = {
    contractPath: options.contractPath,
  };
  if (options.configPath) {
    meta.configPath = options.configPath;
  }

  const result: VerifyDatabaseResult = {
    ok: options.ok,
    summary: options.summary,
    contract,
    target,
    meta,
    timings: {
      total: options.totalTime,
    },
  };

  if (options.code) {
    (result as { code?: string }).code = options.code;
  }

  if (options.marker) {
    (result as { marker?: { storageHash: string; profileHash: string } }).marker = {
      storageHash: options.marker.storageHash,
      profileHash: options.marker.profileHash,
    };
  }

  if (options.missingCodecs) {
    (result as { missingCodecs?: readonly string[] }).missingCodecs = options.missingCodecs;
  }

  if (options.codecCoverageSkipped) {
    (result as { codecCoverageSkipped?: boolean }).codecCoverageSkipped =
      options.codecCoverageSkipped;
  }

  return result;
}

interface SqlTypeMetadata {
  readonly typeId: string;
  readonly familyId: 'sql';
  readonly targetId: string;
  readonly nativeType?: string;
}

type SqlTypeMetadataRegistry = Map<string, SqlTypeMetadata>;

interface SqlFamilyInstanceState {
  readonly codecTypeImports: ReadonlyArray<TypesImportSpec>;
  readonly extensionIds: ReadonlyArray<string>;
  readonly typeMetadataRegistry: SqlTypeMetadataRegistry;
}

export interface SqlControlFamilyInstance
  extends ControlFamilyInstance<'sql', SqlSchemaIRNode>,
    SchemaViewCapable<SqlSchemaIRNode>,
    PslContractInferCapable<SqlSchemaIRNode>,
    OperationPreviewCapable,
    SqlFamilyInstanceState {
  /**
   * The family seam-of-record for on-disk contract reads. Structurally
   * validates the JSON envelope, then hydrates IR-class instances via
   * the per-target ContractSerializer. The single named entry point
   * every CLI on-disk read crosses (TML-2536) — `as Contract` casts
   * in production package sources are a serializer-bypass smell guarded
   * by `pnpm lint:no-contract-cast`.
   */
  deserializeContract(contractJson: unknown): Contract;

  verify(options: {
    readonly driver: SqlControlDriverInstance<string>;
    readonly contract: unknown;
    readonly expectedTargetId: string;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<VerifyDatabaseResult>;

  /**
   * Verify a contract against an already-introspected schema.
   *
   * Callers that need to verify against the live database compose
   * `introspect({ driver })` + `verifySchema({ contract, schema, ... })`.
   * The aggregate verifier hands in the full introspected schema and scopes
   * the returned result to each member's contract space afterwards — so
   * sibling-space tables never survive as `extras`.
   */
  verifySchema(options: {
    readonly contract: unknown;
    readonly schema: SqlSchemaIRNode;
    readonly strict: boolean;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
  }): VerifyDatabaseSchemaResult;

  /**
   * Classifies a diff issue's subject granularity on demand, resolved from
   * its node's `nodeKind` via the target's classifier. Satisfies the
   * {@link import('@internal/framework-components/control').SchemaSubjectClassifierCapable}
   * capability that framework consumers spanning contract spaces (the
   * migration aggregate's unclaimed-elements sweep) detect via
   * `hasSchemaSubjectClassifier` and call instead of reading family/target
   * node vocabulary. Nothing is stamped on the issue or the node.
   */
  classifySubjectGranularity(issue: SchemaDiffIssue): DiffSubjectGranularity | undefined;

  /**
   * Classifies a diff issue's subject storage `entityKind` on demand,
   * resolved from its node's `nodeKind` via the target's classifier —
   * sibling of `classifySubjectGranularity` above, part of the same
   * {@link import('@internal/framework-components/control').SchemaSubjectClassifierCapable}
   * capability. Nothing is stamped on the issue or the node.
   */
  classifyEntityKind(issue: SchemaDiffIssue): string | undefined;

  sign(options: {
    readonly driver: SqlControlDriverInstance<string>;
    readonly contract: unknown;
    readonly contractPath: string;
    readonly configPath?: string;
  }): Promise<SignDatabaseResult>;

  /**
   * Reads the live database schema. `schema` names the single schema to read
   * and only applies when no `contract` is given; see `SqlControlAdapter.introspect`.
   */
  introspect(options: {
    readonly driver: SqlControlDriverInstance<string>;
    readonly contract?: unknown;
    readonly schema?: string;
  }): Promise<SqlSchemaIRNode>;

  inferPslContract(schemaIR: SqlSchemaIRNode): PslDocumentAst;

  lowerAst(
    ast: AnyQueryAst | DdlNode,
    context: LowererContext<unknown>,
  ): Promise<SqlExecuteRequest>;

  /**
   * Inserts the initial marker row for `space` (upsert on `space`).
   * Delegates to the target control adapter's write SPI; see
   * `SqlControlAdapter.initMarker`.
   */
  initMarker(options: {
    readonly driver: SqlControlDriverInstance<string>;
    readonly space: string;
    readonly destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    };
  }): Promise<void>;

  /**
   * Compare-and-swap advance of the marker row for `space`. Returns `true`
   * when the swap matched a row; see `SqlControlAdapter.updateMarker`.
   */
  updateMarker(options: {
    readonly driver: SqlControlDriverInstance<string>;
    readonly space: string;
    readonly expectedFrom: string;
    readonly destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    };
  }): Promise<boolean>;

  /**
   * Appends a ledger entry for `space`; see
   * `SqlControlAdapter.writeLedgerEntry`.
   */
  writeLedgerEntry(options: {
    readonly driver: SqlControlDriverInstance<string>;
    readonly space: string;
    readonly entry: {
      readonly edgeId: string;
      readonly from: string;
      readonly to: string;
      readonly migrationName: string;
      readonly migrationHash: string;
      readonly operations: readonly unknown[];
      readonly destinationContractJson?: unknown;
    };
  }): Promise<void>;

  bootstrapControlTableQueries(): readonly DdlNode[];

  toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview;
}

export type SqlFamilyInstance = SqlControlFamilyInstance;

interface DescriptorWithStorageTypes {
  readonly targetId?: string | undefined;
  readonly types?:
    | {
        readonly storage?:
          | ReadonlyArray<{
              readonly typeId: string;
              readonly familyId: string;
              readonly targetId: string;
              readonly nativeType?: string | undefined;
            }>
          | undefined;
      }
    | undefined;
}

function buildSqlTypeMetadataRegistry(options: {
  readonly target: DescriptorWithStorageTypes;
  readonly adapter: DescriptorWithStorageTypes & { readonly targetId: string };
  readonly extensions: readonly DescriptorWithStorageTypes[];
}): SqlTypeMetadataRegistry {
  const { target, adapter, extensions } = options;
  const registry = new Map<string, SqlTypeMetadata>();
  const targetId = adapter.targetId;
  const descriptors = [target, adapter, ...extensions];

  for (const descriptor of descriptors) {
    const types = descriptor.types;
    const storageTypes = types?.storage;

    if (!storageTypes) {
      continue;
    }

    for (const storageType of storageTypes) {
      if (storageType.familyId === 'sql' && storageType.targetId === targetId) {
        registry.set(storageType.typeId, {
          typeId: storageType.typeId,
          familyId: 'sql',
          targetId: storageType.targetId,
          ...(storageType.nativeType !== undefined ? { nativeType: storageType.nativeType } : {}),
        });
      }
    }
  }

  return registry;
}

interface CrossSpaceFkView {
  readonly id: string;
  readonly contractSpace?: {
    readonly contractJson?: {
      readonly extensions?: Readonly<Record<string, unknown>>;
      readonly storage?: {
        readonly namespaces?: Readonly<Record<string, unknown>>;
      };
    };
  };
}

/**
 * Builds a map from each extension id to the set of extension ids it
 * transitively depends on. Uses the same declared-dependency data that
 * `buildExtensionLoadOrder` in control-stack uses.
 */
function buildTransitiveDependsOnMap(
  extensions: readonly CrossSpaceFkView[],
): Map<string, Set<string>> {
  const directDeps = new Map<string, readonly string[]>();
  for (const ext of extensions) {
    const packs = ext.contractSpace?.contractJson?.extensions;
    const deps = packs !== null && typeof packs === 'object' ? Object.keys(packs) : [];
    directDeps.set(ext.id, deps);
  }

  const result = new Map<string, Set<string>>();
  const resolve = (id: string, visiting: Set<string>): Set<string> => {
    const cached = result.get(id);
    if (cached !== undefined) return cached;
    const set = new Set<string>();
    result.set(id, set);
    for (const depId of directDeps.get(id) ?? []) {
      set.add(depId);
      if (!visiting.has(depId)) {
        visiting.add(depId);
        for (const transitive of resolve(depId, visiting)) {
          set.add(transitive);
        }
        visiting.delete(depId);
      }
    }
    return set;
  };

  for (const ext of extensions) {
    resolve(ext.id, new Set([ext.id]));
  }
  return result;
}

/**
 * Asserts that no cross-space FK in any extension points against the
 * dependency direction.
 *
 * A cross-space FK (target.spaceId present) from extension A pointing at
 * space B is a violation when B depends on A (directly or transitively),
 * because that means A is pointing "upward" against the dependency arrows
 * established by the extension load order.
 *
 * Throws with a diagnostic naming the violating extension (source), the
 * target space, and the direction violation.
 */
function isObjectRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function assertNoCrossSpaceFkReverseReferences(
  extensions: readonly CrossSpaceFkView[],
): void {
  const dependsOnMap = buildTransitiveDependsOnMap(extensions);

  for (const ext of extensions) {
    const namespaces = ext.contractSpace?.contractJson?.storage?.namespaces;
    if (!isObjectRecord(namespaces)) continue;
    for (const ns of Object.values(namespaces)) {
      if (!isObjectRecord(ns)) continue;
      const entries = ns['entries'];
      if (!isObjectRecord(entries)) continue;
      for (const slot of Object.values(entries)) {
        if (!isObjectRecord(slot)) continue;
        for (const table of Object.values(slot)) {
          if (!isObjectRecord(table)) continue;
          const foreignKeys = table['foreignKeys'];
          if (!Array.isArray(foreignKeys)) continue;
          for (const fk of foreignKeys) {
            if (!isObjectRecord(fk)) continue;
            const target = fk['target'];
            if (!isObjectRecord(target)) continue;
            if (target['spaceId'] === undefined) continue;
            const targetSpaceId = target['spaceId'];
            if (typeof targetSpaceId !== 'string') continue;
            // Check if targetSpaceId depends on ext.id (directly or transitively)
            const targetDeps = dependsOnMap.get(targetSpaceId);
            if (targetDeps?.has(ext.id)) {
              throw sqlFamilyError(
                'CONTRACT.FOREIGN_KEY_INVALID',
                `Cross-space FK reverse-reference detected: extension "${ext.id}" has a cross-space FK targeting space "${targetSpaceId}", but "${targetSpaceId}" depends on "${ext.id}". Cross-space FKs must follow the dependency direction (a space can only reference spaces it depends on, not spaces that depend on it).`,
                {
                  why: 'The foreign key points against the contract-space dependency direction.',
                  fix: 'Move the foreign key to the depending space, or restructure the extension dependencies so the referencing space depends on the referenced one.',
                  meta: { extensionId: ext.id, targetSpaceId },
                },
              );
            }
          }
        }
      }
    }
  }
}

export function createSqlFamilyInstance<TTargetId extends string>(
  stack: ControlStack<'sql', TTargetId>,
): SqlFamilyInstance {
  if (!stack.adapter) {
    throw new InternalError('SQL family requires an adapter descriptor in ControlStack');
  }

  const target = stack.target as unknown as TargetDescriptor<'sql', TTargetId> &
    DescriptorWithStorageTypes;
  const adapter = stack.adapter as unknown as SqlControlAdapterDescriptor<TTargetId> &
    DescriptorWithStorageTypes;
  const extensions =
    stack.extensions as unknown as readonly (SqlControlExtensionDescriptor<TTargetId> &
      DescriptorWithStorageTypes)[];

  // Descriptor self-consistency check.
  // Each extension that exposes a `contractSpace` must publish a
  // `headRef.hash` that matches the canonical hash recomputed from its
  // `contractJson`. A stale value would silently corrupt every downstream
  // boundary that trusts `headRef.hash` as the canonical identity (drift
  // detection, on-disk artefact emission, runner marker writes). Failing
  // fast at descriptor-load time turns "extension author shipped an
  // inconsistent descriptor" into an explicit, actionable error
  // (`MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH`) rather than a confusing
  // mismatch surfacing several layers downstream.
  for (const extension of extensions) {
    if (extension.contractSpace) {
      const { contractJson, headRef } = extension.contractSpace;
      assertDescriptorSelfConsistency({
        extensionId: extension.id,
        target: contractJson.target,
        targetFamily: contractJson.targetFamily,
        storage: contractJson.storage,
        headRefHash: headRef.hash,
        ...sqlContractCanonicalizationHooks,
      });
    }
  }

  assertNoCrossSpaceFkReverseReferences(extensions);

  const { codecTypeImports, extensionIds } = stack;

  const typeMetadataRegistry = buildSqlTypeMetadataRegistry({
    target,
    adapter,
    extensions: extensions,
  });

  // Lazily construct the control adapter on first use, then memoize it.
  // Merely building a family instance must not instantiate the adapter —
  // that would change the load/instantiate semantics of the whole stack
  // wherever a family is created (every CLI command, emit, verify, …), not
  // just the migration paths that actually need it. Memoizing also avoids
  // the previous per-operation re-instantiation (a fresh adapter on every
  // call). Family-instance methods accept `SqlControlDriverInstance<string>`
  // (the family API isn't generic on the target id); the adapter
  // descriptor's `create` returns the concrete `SqlControlAdapter<TTargetId>`,
  // widened to `string` to match the family-level driver type without a
  // per-method probe.
  let controlAdapter: SqlControlAdapter<string> | undefined;
  const getControlAdapter = (): SqlControlAdapter<string> =>
    (controlAdapter ??= adapter.create(stack));

  const targetSerializer = (
    target as unknown as {
      contractSerializer?: {
        deserializeContract(json: unknown): Contract<SqlStorage>;
        serializeContract(contract: Contract<SqlStorage>): unknown;
      };
    }
  ).contractSerializer;
  // Database→PSL inference is target logic (it owns the dialect type/default
  // maps and walks its own schema tree), so it is read off the descriptor like
  // `contractSerializer`. Absent for targets without `contract infer` (Mongo).
  const targetInferPslContract = blindCast<
    SqlControlTargetDescriptor<TTargetId, unknown>,
    'reading the optional target-descriptor inferPslContract hook'
  >(target).inferPslContract;
  // The full-tree node diff the verify VERDICT derives from. Read lazily so
  // construction-only stub descriptors (schema-view tests) keep working; the
  // throw happens at verify time.
  const diffSchema = blindCast<
    { readonly diffSchema?: SqlSchemaDiffFn },
    'reading the target-descriptor diffSchema hook'
  >(target).diffSchema;
  // The target's nodeKind → granularity classifier, resolved on demand by the
  // verdict and by the instance's `classifySubjectGranularity` method below —
  // never stamped onto an issue. Read lazily for the same
  // construction-only-stub reason as `diffSchema`; the throw happens at call
  // time.
  const targetGranularityOf = blindCast<
    { readonly classifySubjectGranularity?: (nodeKind: string) => DiffSubjectGranularity },
    'reading the target-descriptor classifySubjectGranularity hook'
  >(target).classifySubjectGranularity;
  // The target's nodeKind → storage entityKind classifier — sibling of
  // `targetGranularityOf` above, read the same lazy way for the same
  // construction-only-stub reason.
  const targetEntityKindOf = blindCast<
    { readonly classifyEntityKind?: (nodeKind: string) => string | undefined },
    'reading the target-descriptor classifyEntityKind hook'
  >(target).classifyEntityKind;
  // `contract infer` needs each extension pack's already-assembled contract,
  // carried as-is (no merging — that is the contract-spaces machinery's
  // concern), paired with the `spaceId` its descriptor was registered under
  // (neither the contract JSON nor `ContractSpace` self-declares it), so the
  // target hook can omit elements those contracts describe and qualify a
  // cross-space relation with the owning pack's space id.
  const describedContracts: readonly SqlDescribedContractSpace[] = extensions.flatMap(
    (extension) =>
      extension.contractSpace
        ? [{ spaceId: extension.id, contract: extension.contractSpace.contractJson }]
        : [],
  );
  const deserializeWithTargetSerializer = (contractOrJson: unknown): Contract<SqlStorage> => {
    const serializer = targetSerializer ?? new SqlContractSerializer();
    const json =
      targetSerializer !== undefined && !isPlainRecord(contractOrJson)
        ? targetSerializer.serializeContract(
            blindCast<
              Contract<SqlStorage>,
              'isPlainRecord returned false, so contractOrJson is a class instance, not raw JSON'
            >(contractOrJson),
          )
        : contractOrJson;
    return serializer.deserializeContract(json) as Contract<SqlStorage>;
  };

  return {
    familyId: 'sql',
    codecTypeImports,
    extensionIds,
    typeMetadataRegistry,

    deserializeContract(contractJson: unknown): Contract {
      return deserializeWithTargetSerializer(contractJson);
    },

    async verify(verifyOptions: {
      readonly driver: SqlControlDriverInstance<string>;
      readonly contract: unknown;
      readonly expectedTargetId: string;
      readonly contractPath: string;
      readonly configPath?: string;
    }): Promise<VerifyDatabaseResult> {
      const {
        driver,
        contract: rawContract,
        expectedTargetId,
        contractPath,
        configPath,
      } = verifyOptions;
      const startTime = Date.now();

      const contract = deserializeWithTargetSerializer(rawContract) as Contract<SqlStorage>;

      const contractStorageHash = contract.storage.storageHash;
      const contractProfileHash = contract.profileHash;
      const contractTarget = contract.target;

      const marker = await getControlAdapter().readMarker(driver, APP_SPACE_ID);

      let missingCodecs: readonly string[] | undefined;
      let codecCoverageSkipped = false;
      const supportedTypeIds = collectSupportedCodecTypeIds([adapter, target, ...extensions]);
      if (supportedTypeIds.length === 0) {
        codecCoverageSkipped = true;
      } else {
        const supportedSet = new Set(supportedTypeIds);
        const usedTypeIds = extractCodecTypeIdsFromContract(contract);
        const missing = usedTypeIds.filter((id) => !supportedSet.has(id));
        if (missing.length > 0) {
          missingCodecs = missing;
        }
      }

      if (!marker) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: VERIFY_CODE_MARKER_MISSING,
          summary: 'Marker missing',
          contractStorageHash,
          expectedTargetId,
          contractPath,
          totalTime,
          ...(contractProfileHash ? { contractProfileHash } : {}),
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          ...(configPath ? { configPath } : {}),
        });
      }

      if (contractTarget !== expectedTargetId) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: VERIFY_CODE_TARGET_MISMATCH,
          summary: 'Target mismatch',
          contractStorageHash,
          marker,
          expectedTargetId,
          actualTargetId: contractTarget,
          contractPath,
          totalTime,
          ...(contractProfileHash ? { contractProfileHash } : {}),
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          ...(configPath ? { configPath } : {}),
        });
      }

      if (marker.storageHash !== contractStorageHash) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: VERIFY_CODE_HASH_MISMATCH,
          summary: 'Hash mismatch',
          contractStorageHash,
          marker,
          expectedTargetId,
          contractPath,
          totalTime,
          ...(contractProfileHash ? { contractProfileHash } : {}),
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          ...(configPath ? { configPath } : {}),
        });
      }

      if (contractProfileHash && marker.profileHash !== contractProfileHash) {
        const totalTime = Date.now() - startTime;
        return createVerifyResult({
          ok: false,
          code: VERIFY_CODE_HASH_MISMATCH,
          summary: 'Hash mismatch',
          contractStorageHash,
          contractProfileHash,
          marker,
          expectedTargetId,
          contractPath,
          totalTime,
          ...(missingCodecs ? { missingCodecs } : {}),
          ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
          ...(configPath ? { configPath } : {}),
        });
      }

      const totalTime = Date.now() - startTime;
      return createVerifyResult({
        ok: true,
        summary: 'Database matches contract',
        contractStorageHash,
        marker,
        expectedTargetId,
        contractPath,
        totalTime,
        ...(contractProfileHash ? { contractProfileHash } : {}),
        ...(missingCodecs ? { missingCodecs } : {}),
        ...(codecCoverageSkipped ? { codecCoverageSkipped } : {}),
        ...(configPath ? { configPath } : {}),
      });
    },

    verifySchema(options: {
      readonly contract: unknown;
      readonly schema: SqlSchemaIRNode;
      readonly strict: boolean;
      readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
    }): VerifyDatabaseSchemaResult {
      const contract = deserializeWithTargetSerializer(options.contract) as Contract<SqlStorage>;
      if (!diffSchema) {
        throw missingDescriptorOperationError(target.targetId, 'diffSchema');
      }
      if (!targetGranularityOf) {
        throw missingDescriptorOperationError(target.targetId, 'classifySubjectGranularity');
      }
      // THE VERDICT: the target's full-tree node diff, graded by the
      // family's post-diff filters (strict gating + control-policy
      // disposition), plus the codec verifyType hook findings. The result
      // is issue-based — `ok` holds exactly when both issue lists are empty.
      return verifySqlSchemaByDiff({
        contract,
        schema: options.schema,
        strict: options.strict,
        frameworkComponents: options.frameworkComponents,
        diffSchema,
        granularityOf: targetGranularityOf,
      });
    },

    /**
     * Classifies a diff issue's subject granularity on demand, by resolving
     * its node's `nodeKind` through the target's classifier — the
     * {@link import('@internal/framework-components/control').SchemaSubjectClassifierCapable}
     * capability. Framework consumers spanning contract spaces (the
     * migration aggregate's unclaimed-elements sweep) detect and call this
     * instead of reaching into the concrete schema-IR node, which they
     * cannot read; nothing is stamped on the issue or the node.
     */
    classifySubjectGranularity(issue: SchemaDiffIssue): DiffSubjectGranularity | undefined {
      if (!targetGranularityOf) {
        throw missingDescriptorOperationError(target.targetId, 'classifySubjectGranularity');
      }
      return classifyDiffSubjectGranularity(issue, targetGranularityOf);
    },
    /**
     * Classifies a diff issue's subject storage `entityKind` on demand, by
     * resolving its node's `nodeKind` through the target's classifier —
     * the sibling of `classifySubjectGranularity` above, and part of the
     * same {@link import('@internal/framework-components/control').SchemaSubjectClassifierCapable}
     * capability.
     */
    classifyEntityKind(issue: SchemaDiffIssue): string | undefined {
      if (!targetEntityKindOf) {
        throw missingDescriptorOperationError(target.targetId, 'classifyEntityKind');
      }
      return classifyDiffEntityKind(issue, targetEntityKindOf);
    },
    async sign(options: {
      readonly driver: SqlControlDriverInstance<string>;
      readonly contract: unknown;
      readonly contractPath: string;
      readonly configPath?: string;
    }): Promise<SignDatabaseResult> {
      const { driver, contract: contractInput, contractPath, configPath } = options;
      const startTime = Date.now();

      const contract = deserializeWithTargetSerializer(contractInput) as Contract<SqlStorage>;

      const contractStorageHash = contract.storage.storageHash;
      const contractProfileHash =
        'profileHash' in contract && typeof contract.profileHash === 'string'
          ? contract.profileHash
          : contractStorageHash;
      const contractTarget = contract.target;

      const controlAdapter = getControlAdapter();
      const lowererContext = { contract };
      for (const query of controlAdapter.bootstrapSignMarkerQueries()) {
        const lowered = await controlAdapter.lowerToExecuteRequest(query, lowererContext);
        await driver.query(lowered.sql, lowered.params);
      }

      const existingMarker = await controlAdapter.readMarker(driver, APP_SPACE_ID);

      let markerCreated = false;
      let markerUpdated = false;
      let previousHashes: { storageHash?: string; profileHash?: string } | undefined;

      if (!existingMarker) {
        await controlAdapter.insertMarker(driver, APP_SPACE_ID, {
          storageHash: contractStorageHash,
          profileHash: contractProfileHash,
        });
        markerCreated = true;
      } else {
        const existingStorageHash = existingMarker.storageHash;
        const existingProfileHash = existingMarker.profileHash;

        const storageHashMatches = existingStorageHash === contractStorageHash;
        const profileHashMatches = existingProfileHash === contractProfileHash;

        if (!storageHashMatches || !profileHashMatches) {
          previousHashes = {
            storageHash: existingStorageHash,
            profileHash: existingProfileHash,
          };
          const updated = await controlAdapter.updateMarker(
            driver,
            APP_SPACE_ID,
            existingStorageHash,
            {
              storageHash: contractStorageHash,
              profileHash: contractProfileHash,
            },
          );
          if (!updated) {
            throw sqlFamilyError(
              'MIGRATION.MARKER_CAS_FAILURE',
              'CAS conflict: marker was modified by another process during sign',
              {
                why: 'Another process updated the contract marker between the read and the compare-and-swap write.',
                fix: 'Re-run the sign command; if it keeps failing, make sure only one migration process runs at a time.',
                meta: { space: APP_SPACE_ID },
              },
            );
          }
          markerUpdated = true;
        }
      }

      let summary: string;
      if (markerCreated) {
        summary = 'Database signed (marker created)';
      } else if (markerUpdated) {
        summary = `Database signed (marker updated from ${previousHashes?.storageHash ?? 'unknown'})`;
      } else {
        summary = 'Database already signed with this contract';
      }

      const totalTime = Date.now() - startTime;

      return {
        ok: true,
        summary,
        contract: {
          storageHash: contractStorageHash,
          profileHash: contractProfileHash,
        },
        target: {
          expected: contractTarget,
          actual: contractTarget,
        },
        marker: {
          created: markerCreated,
          updated: markerUpdated,
          ...(previousHashes ? { previous: previousHashes } : {}),
        },
        meta: {
          contractPath,
          ...(configPath ? { configPath } : {}),
        },
        timings: {
          total: totalTime,
        },
      };
    },
    async readMarker(options: {
      readonly driver: SqlControlDriverInstance<string>;
      readonly space: string;
    }): Promise<ContractMarkerRecord | null> {
      return getControlAdapter().readMarker(options.driver, options.space);
    },
    async readAllMarkers(options: {
      readonly driver: SqlControlDriverInstance<string>;
    }): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
      return getControlAdapter().readAllMarkers(options.driver);
    },
    async readLedger(options: {
      readonly driver: SqlControlDriverInstance<string>;
      readonly space?: string;
    }): Promise<readonly LedgerEntryRecord[]> {
      return getControlAdapter().readLedger(options.driver, options.space);
    },
    async initMarker(options: {
      readonly driver: SqlControlDriverInstance<string>;
      readonly space: string;
      readonly destination: {
        readonly storageHash: string;
        readonly profileHash: string;
        readonly invariants?: readonly string[];
      };
    }): Promise<void> {
      return getControlAdapter().initMarker(options.driver, options.space, options.destination);
    },
    async updateMarker(options: {
      readonly driver: SqlControlDriverInstance<string>;
      readonly space: string;
      readonly expectedFrom: string;
      readonly destination: {
        readonly storageHash: string;
        readonly profileHash: string;
        readonly invariants?: readonly string[];
      };
    }): Promise<boolean> {
      return getControlAdapter().updateMarker(
        options.driver,
        options.space,
        options.expectedFrom,
        options.destination,
      );
    },
    async writeLedgerEntry(options: {
      readonly driver: SqlControlDriverInstance<string>;
      readonly space: string;
      readonly entry: {
        readonly edgeId: string;
        readonly from: string;
        readonly to: string;
        readonly migrationName: string;
        readonly migrationHash: string;
        readonly operations: readonly unknown[];
        readonly destinationContractJson?: unknown;
      };
    }): Promise<void> {
      return getControlAdapter().writeLedgerEntry(options.driver, options.space, options.entry);
    },
    async introspect(options: {
      readonly driver: SqlControlDriverInstance<string>;
      readonly contract?: unknown;
      readonly schema?: string;
    }): Promise<SqlSchemaIRNode> {
      return getControlAdapter().introspect(options.driver, options.contract, options.schema);
    },

    inferPslContract(schemaIR: SqlSchemaIRNode): PslDocumentAst {
      if (!targetInferPslContract) {
        throw sqlFamilyError(
          'CONTRACT.INFER_UNSUPPORTED',
          `Target "${target.targetId}" does not support contract infer (no inferPslContract on its descriptor).`,
          {
            why: 'The target descriptor does not provide the inferPslContract hook, so a PSL contract cannot be inferred from the database schema.',
            fix: 'Use a target package that supports contract infer, or author the contract instead of inferring it.',
            meta: { targetId: target.targetId },
          },
        );
      }
      return targetInferPslContract(schemaIR, describedContracts);
    },

    lowerAst(
      ast: AnyQueryAst | DdlNode,
      context: LowererContext<unknown>,
    ): Promise<SqlExecuteRequest> {
      return getControlAdapter().lowerToExecuteRequest(ast, context);
    },

    bootstrapControlTableQueries(): readonly DdlNode[] {
      return getControlAdapter().bootstrapControlTableQueries();
    },

    toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview {
      return sqlOperationsToPreview(operations);
    },

    toSchemaView(schema: SqlSchemaIRNode): CoreSchemaView {
      // Walk the schema-IR tree's own structure (root → namespaces → tables)
      // into one flat list of table nodes. A root that exposes a `namespaces`
      // record (Postgres) contributes each namespace's tables; a flat root
      // (SQLite) is its own single namespace. The single-schema common case
      // renders the same table-level view as today — no synthetic namespace
      // level.
      const root = blindCast<
        {
          readonly namespaces?: Readonly<
            Record<string, { readonly tables: Record<string, SqlTableIR> }>
          >;
          readonly tables?: Record<string, SqlTableIR>;
        },
        'structural read of the schema-IR tree own namespaces/tables records'
      >(schema);
      // A multi-namespace root qualifies every table's display name with its
      // namespace key, so same-named tables in different namespaces (e.g.
      // public.thing and auth.thing) render distinct ids and labels. The
      // single-namespace case (and a flat SQLite root) keeps today's bare
      // names. Synthesized constraint/index fallback names keep the bare table
      // name — that is the name the database derives them from.
      const namespaceEntries: ReadonlyArray<[string | undefined, Record<string, SqlTableIR>]> =
        root.namespaces !== undefined
          ? Object.entries(root.namespaces).map(
              ([namespaceKey, namespace]): [string, Record<string, SqlTableIR>] => [
                namespaceKey,
                namespace.tables,
              ],
            )
          : [[undefined, root.tables ?? {}]];
      const qualify = namespaceEntries.length > 1;
      const tableEntries: ReadonlyArray<[string, string, SqlTableIR]> = namespaceEntries.flatMap(
        ([namespaceKey, tables]) =>
          Object.entries(tables).map(([tableName, table]): [string, string, SqlTableIR] => [
            qualify && namespaceKey !== undefined ? `${namespaceKey}.${tableName}` : tableName,
            tableName,
            table,
          ]),
      );
      const tableNodes: readonly SchemaTreeNode[] = tableEntries.map(
        ([displayName, tableName, table]: [string, string, SqlTableIR]) => {
          const children: SchemaTreeNode[] = [];

          const columnNodes: SchemaTreeNode[] = [];
          for (const [columnName, column] of Object.entries(table.columns)) {
            const typeDisplay = column.nativeType;
            const nullability = column.nullable ? 'nullable' : 'not nullable';
            const label = `${columnName}: ${typeDisplay} (${nullability})`;
            columnNodes.push(
              new SchemaTreeNode({
                kind: 'field',
                id: `column-${displayName}-${columnName}`,
                label,
                meta: {
                  nativeType: column.nativeType,
                  nullable: column.nullable,
                  ...ifDefined('default', column.default),
                },
              }),
            );
          }

          if (columnNodes.length > 0) {
            children.push(
              new SchemaTreeNode({
                kind: 'collection',
                id: `columns-${displayName}`,
                label: 'columns',
                children: columnNodes,
              }),
            );
          }

          if (table.primaryKey) {
            const pkColumns = table.primaryKey.columns.join(', ');
            children.push(
              new SchemaTreeNode({
                kind: 'index',
                id: `primary-key-${displayName}`,
                label: `primary key: ${pkColumns}`,
                meta: {
                  columns: table.primaryKey.columns,
                  ...(table.primaryKey.name ? { name: table.primaryKey.name } : {}),
                },
              }),
            );
          }

          for (const unique of table.uniques) {
            const name = unique.name ?? `${tableName}_${unique.columns.join('_')}_unique`;
            const label = `unique ${name}`;
            children.push(
              new SchemaTreeNode({
                kind: 'index',
                id: `unique-${displayName}-${name}`,
                label,
                meta: {
                  columns: unique.columns,
                  unique: true,
                },
              }),
            );
          }

          for (const index of table.indexes) {
            const name = index.name;
            const label = index.unique ? `unique index ${name}` : `index ${name}`;
            children.push(
              new SchemaTreeNode({
                kind: 'index',
                id: `index-${displayName}-${name}`,
                label,
                meta: {
                  columns: index.columns,
                  unique: index.unique,
                },
              }),
            );
          }

          const tableMeta: Record<string, unknown> = {};
          if (table.primaryKey) {
            tableMeta['primaryKey'] = table.primaryKey.columns;
            if (table.primaryKey.name) {
              tableMeta['primaryKeyName'] = table.primaryKey.name;
            }
          }
          if (table.foreignKeys.length > 0) {
            tableMeta['foreignKeys'] = table.foreignKeys.map((fk) => ({
              columns: fk.columns,
              referencedTable: fk.referencedTable,
              referencedColumns: fk.referencedColumns,
              ...(fk.name ? { name: fk.name } : {}),
            }));
          }

          return new SchemaTreeNode({
            kind: 'entity',
            id: `table-${displayName}`,
            label: `table ${displayName}`,
            ...(Object.keys(tableMeta).length > 0 ? { meta: tableMeta } : {}),
            ...(children.length > 0 ? { children } : {}),
          });
        },
      );

      return {
        root: new SchemaTreeNode({
          kind: 'root',
          id: 'sql-schema',
          label: 'database',
          ...(tableNodes.length > 0 ? { children: tableNodes } : {}),
        }),
      };
    },
  };
}
