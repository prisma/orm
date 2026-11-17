import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Contract } from '@internal/contract/types';
import type {
  ControlStack,
  MigrationPlan,
  MigrationPlanOperation,
  PlanOrigin,
} from '@internal/framework-components/control';
import { type } from 'arktype';
import {
  errorDescribeInvalidMetadata,
  errorDescribeMissingEndContract,
  errorInvalidOperationEntry,
  errorMigrationContractViewMissing,
  errorOperationsNotArray,
} from './errors';
import { computeMigrationHash } from './hash';
import { deriveProvidedInvariants } from './invariants';
import type { MigrationMetadata } from './metadata';
import { MigrationOpSchema } from './op-schema';
import type { MigrationOps } from './package';

export interface MigrationMeta {
  readonly from: string | null;
  readonly to: string;
}

// `from` rejects empty strings to mirror `MigrationMetadataSchema` in
// `./io.ts`. Without this match, an authored migration could `describe()` with
// `from: ''` and pass `buildMigrationArtifacts`'s validation, only to have
// `readMigrationPackage` reject the resulting `migration.json` later — the
// two validators must agree on the legal value space.
const MigrationMetaSchema = type({
  from: 'string > 0 | null',
  to: 'string',
});

/**
 * Base class for migrations.
 *
 * A `Migration` subclass is itself a `MigrationPlan`: CLI commands and the
 * runner can consume it directly via `targetId`, `operations`, `origin`, and
 * `destination`.
 *
 * The from/to identities come from `describe()`. A migration provides them in
 * one of two ways:
 *  - **Contract-derived (default):** assign the `contract.json` imports from
 *    the snapshot store (`migrations/snapshots/<hex>/contract.json`) to
 *    `startContractJson` / `endContractJson`; the concrete `describe()` below
 *    derives `to`/`from` from their
 *    `storage.storageHash`. The family bases additionally expose typed view
 *    getters (`startContract` / `endContract`) over the same JSON.
 *  - **Override (e.g. extension migrations that carry no contract):** override
 *    `describe()` directly; the override wins and the JSON fields are unused.
 *
 * The `Start` / `End` generics carry each migration's precise contract types so
 * the family-base view getters resolve to fully-typed views.
 */
export abstract class Migration<
  _TOperation extends MigrationPlanOperation = MigrationPlanOperation,
  TFamilyId extends string = string,
  TTargetId extends string = string,
  _Start extends Contract = Contract,
  _End extends Contract = Contract,
> implements MigrationPlan
{
  abstract readonly targetId: string;

  /**
   * The migration's end-state contract JSON (the `contract.json` import from
   * the snapshot store). When set, the derived `describe()` reads `to` from its
   * `storage.storageHash`. Family bases build the typed `endContract` view from
   * it. Optional so `describe()`-overriding migrations (no contract) compile.
   *
   * Typed with a plain `storageHash: string`, not the branded
   * `StorageHashBase`, so a raw `contract.json` import — whose `storageHash`
   * is an untyped string literal — is assignable without a cast. The full
   * `Start`/`End` contract typing is applied downstream in the family bases'
   * view getters (via `<Family>ContractView.fromJson<…>`).
   */
  readonly endContractJson?: { readonly storage: { readonly storageHash: string } };

  /**
   * The migration's start-state contract JSON (the `contract.json` import
   * from the snapshot store). Absent for a baseline migration (`from`
   * derives to `null`). Family bases build the typed `startContract` view from
   * it.
   */
  readonly startContractJson?: { readonly storage: { readonly storageHash: string } };

  /**
   * Assembled `ControlStack` injected by the orchestrator (`runMigration`).
   *
   * Subclasses (e.g. `PostgresMigration`) read the stack to materialize their
   * adapter once per instance. Optional at the abstract level so unit tests can
   * construct `Migration` instances purely for `operations` / `describe`
   * assertions without needing a real stack; concrete subclasses that need the
   * stack at runtime should narrow the parameter to required.
   */
  protected readonly stack: ControlStack<TFamilyId, TTargetId> | undefined;

  constructor(stack?: ControlStack<TFamilyId, TTargetId>) {
    this.stack = stack;
  }

  /**
   * Ordered list of operations this migration performs.
   *
   * Implemented as a getter so that subclasses can either precompute the list
   * in their constructor or build it lazily per access. Entries may be Promises
   * when the target requires async codec resolution (e.g. DDL literal defaults).
   */
  abstract get operations(): readonly (MigrationPlanOperation | Promise<MigrationPlanOperation>)[];

  /**
   * Metadata inputs used to build `migration.json` and to derive the plan's
   * origin/destination identities.
   *
   * Default derivation: `to = endContractJson.storage.storageHash`,
   * `from = startContractJson?.storage.storageHash ?? null`. A migration that
   * carries no contract JSON (e.g. an extension migration) must override this;
   * otherwise it throws, since `migration.json` requires a `to` identity.
   */
  describe(): MigrationMeta {
    const end = this.endContractJson;
    if (end === undefined) {
      throw errorDescribeMissingEndContract();
    }
    return {
      from: this.startContractJson?.storage.storageHash ?? null,
      to: end.storage.storageHash,
    };
  }

  /**
   * Called by {@link Migration.readOperations} before each read of `operations`: a migration that
   * builds state while its operations are read, such as the schema its earlier rename operations
   * leave behind, discards it here so every read starts from the start contract. The default keeps
   * no state.
   */
  protected beginOperationsRead(): void {}

  /** Reads `migration`'s operations from the start contract; read them only through this. */
  static readOperations(
    migration: Migration,
  ): readonly (MigrationPlanOperation | Promise<MigrationPlanOperation>)[] {
    migration.beginOperationsRead();
    return migration.operations;
  }

  get origin(): PlanOrigin | null {
    const from = this.describe().from;
    return from === null ? null : { storageHash: from };
  }

  get destination(): { readonly storageHash: string } {
    return { storageHash: this.describe().to };
  }
}

/**
 * Lazy-memoized `endContract` / `startContract` view accessors, one instance
 * held per migration. Each target base (`MongoMigration`, `SqliteMigration`,
 * `PostgresMigration`) creates one `MigrationContractViews` field from
 * `this` — passing its own `<Family>ContractView.fromJson<…>` as `fromJson`
 * and a name for error messages — and forwards its
 * `endContract`/`startContract` getters to it.
 *
 * `endContract` throws `MIGRATION.CONTRACT_VIEW_MISSING` when the migration
 * has no `endContractJson` (mirrors `describe()`'s own requirement).
 * `startContract` returns `null` for a baseline migration (no
 * `startContractJson`) instead of throwing.
 */
export class MigrationContractViews<TView> {
  #endView?: TView;
  #startView?: TView | null;

  constructor(
    private readonly migration: Migration,
    private readonly className: string,
    private readonly fromJson: (json: unknown) => TView,
  ) {}

  get endContract(): TView {
    if (this.#endView === undefined) {
      const json = this.migration.endContractJson;
      if (json === undefined) {
        throw errorMigrationContractViewMissing(this.className, 'endContract', 'endContractJson');
      }
      this.#endView = this.fromJson(json);
    }
    return this.#endView;
  }

  get startContract(): TView | null {
    if (this.#startView === undefined) {
      const json = this.migration.startContractJson;
      this.#startView = json === undefined ? null : this.fromJson(json);
    }
    return this.#startView;
  }
}

/**
 * Returns true when `import.meta.url` resolves to the same file that was
 * invoked as the node entrypoint (`process.argv[1]`). Used by
 * `MigrationCLI.run` (in `@internal/cli/migration-cli`) to no-op when
 * the migration module is being imported (e.g. by another script) rather
 * than executed directly.
 */
export function isDirectEntrypoint(importMetaUrl: string): boolean {
  const metaFilename = fileURLToPath(importMetaUrl);
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(metaFilename) === realpathSync(argv1);
  } catch {
    return false;
  }
}

/**
 * In-memory artifacts produced from a `Migration` instance: the
 * serialized `ops.json` body, the `migration.json` metadata object, and
 * its serialized form. Returned by `buildMigrationArtifacts` so callers
 * (today: `MigrationCLI.run` in `@internal/cli/migration-cli`) can
 * decide how to persist them — write to disk, print in dry-run, ship
 * over the wire — without coupling artifact construction to file I/O.
 *
 * `metadataJson` is `JSON.stringify(metadata, null, 2)` — the canonical
 * on-disk shape that the arktype loader-schema in `./io` validates.
 */
export interface MigrationArtifacts {
  readonly opsJson: string;
  readonly metadata: MigrationMetadata;
  readonly metadataJson: string;
}

/**
 * Build the attested metadata from `describe()`-derived metadata, the
 * operations list, and the previously-scaffolded metadata (if any).
 *
 * When a `migration.json` already exists for this package (the common
 * case: it was scaffolded by `migration plan`), preserve `createdAt`
 * set there — that field is owned by the CLI scaffolder, not the authored
 * class. Only the `describe()`-derived fields (`from`, `to`) and the
 * operations change as the author iterates. When no metadata exists yet
 * (a bare `migration.ts` run from scratch), synthesize a minimal but
 * schema-conformant record so the resulting package can still be read,
 * verified, and applied.
 *
 * The `migrationHash` is recomputed against the current metadata + ops so
 * the on-disk artifacts are always fully attested.
 */
function buildAttestedMetadata(
  meta: MigrationMeta,
  ops: MigrationOps,
  existing: Partial<MigrationMetadata> | null,
): MigrationMetadata {
  const baseMetadata: Omit<MigrationMetadata, 'migrationHash'> = {
    from: meta.from,
    to: meta.to,
    providedInvariants: deriveProvidedInvariants(ops),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };

  const migrationHash = computeMigrationHash(baseMetadata, ops);
  return { ...baseMetadata, migrationHash };
}

/**
 * Pure conversion from a `Migration` instance (plus the previously
 * scaffolded metadata, when one exists on disk) to the in-memory
 * artifacts that downstream tooling persists. Owns metadata validation,
 * metadata synthesis/preservation, and the content-addressed
 * `migrationHash` computation, but performs no file I/O — callers handle
 * reads (to source `existing`) and writes (to persist `opsJson` /
 * `metadataJson`).
 */
export async function buildMigrationArtifacts(
  instance: Migration,
  existing: Partial<MigrationMetadata> | null,
): Promise<MigrationArtifacts> {
  const rawOps = Migration.readOperations(instance);
  if (!Array.isArray(rawOps)) {
    throw errorOperationsNotArray();
  }
  const ops = await Promise.all(rawOps);

  for (let index = 0; index < ops.length; index++) {
    const result = MigrationOpSchema(ops[index]);
    if (result instanceof type.errors) {
      throw errorInvalidOperationEntry(index, result.summary);
    }
  }

  const rawMeta: unknown = instance.describe();
  const parsed = MigrationMetaSchema(rawMeta);
  if (parsed instanceof type.errors) {
    throw errorDescribeInvalidMetadata(parsed.summary);
  }

  const metadata = buildAttestedMetadata(parsed, ops, existing);

  return {
    opsJson: JSON.stringify(ops, null, 2),
    metadata,
    metadataJson: JSON.stringify(metadata, null, 2),
  };
}
