import type { Contract } from '@internal/contract/types';
import type {
  MigrationOperationPolicy,
  SqlMigrationPlannerPlanOptions,
  SqlPlannerConflict,
  SqlPlannerFailureResult,
  SuppressionRecord,
} from '@internal/family-sql/control';
import {
  controlPolicyForCall,
  extractCodecControlHooks,
  partitionCallsByControlPolicy,
  partitionIssuesByControlPolicy,
  planFieldEventOperations,
  plannerFailure,
} from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  MigrationOperationClass,
  MigrationPlanner,
  MigrationPlanWithAuthoringSurface,
  MigrationScaffoldContext,
  SchemaDiffIssue,
  SchemaOwnership,
} from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { namingOf, parseWireName } from '@internal/sql-schema-ir/naming';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { SqlCheckConstraintIR, SqlIndexIR } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { PostgresRlsPolicy } from '../postgres-rls-policy';
import { postgresNodeStorageCoordinate } from '../schema-ir/node-storage-coordinate';
import { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { PostgresPolicySchemaNode } from '../schema-ir/postgres-policy-schema-node';
import type { SqlSchemaDiffNode } from '../schema-ir/schema-node-kinds';
import {
  renderPostgresSuppression,
  resolveNamespaceIdForDdlSchema,
  resolvePostgresCallControlPolicySubject,
  resolvePostgresNodeIssueControlPolicySubject,
  resolvePostgresNodeIssueCreationFactoryName,
} from './control-policy';
import { buildPostgresPlanDiff } from './diff-database-schema';
import {
  coalesceSubtreeIssues,
  conflictForDisallowedCall,
  issueNode,
  issueSchemaName,
  planIssues,
} from './issue-planner';
import type { PostgresOpFactoryCall } from './op-factory-call';
import {
  CreatePostgresRlsPolicyCall,
  DropColumnCall,
  DropPostgresRlsPolicyCall,
  DropTableCall,
  RenameCheckConstraintCall,
  RenameIndexCall,
  RenamePostgresRlsPolicyCall,
} from './op-factory-call';
import { TypeScriptRenderablePostgresMigration } from './planner-produced-postgres-migration';
import { postgresPlannerStrategies } from './planner-strategies';
import { resolveDdlSchemaForNamespaceStorage } from './resolve-ddl-schema';
import { verifyPostgresNamespacePresence } from './verify-postgres-namespaces';

type PlannerFrameworkComponents = SqlMigrationPlannerPlanOptions extends {
  readonly frameworkComponents: infer T;
}
  ? T
  : ReadonlyArray<unknown>;

type PlannerOptionsWithComponents = SqlMigrationPlannerPlanOptions & {
  readonly frameworkComponents: PlannerFrameworkComponents;
};

export function createPostgresMigrationPlanner(
  lowerer: ExecuteRequestLowerer,
): PostgresMigrationPlanner {
  return new PostgresMigrationPlanner(lowerer);
}

/**
 * Result of `PostgresMigrationPlanner.plan()`. A discriminated union whose
 * success variant carries a `TypeScriptRenderablePostgresMigration` — a
 * migration object that both the CLI (via `renderTypeScript()`) and the
 * SQL-typed callers (via `operations`, `describe()`, etc.) consume
 * uniformly.
 */
export type PostgresPlanResult =
  | {
      readonly kind: 'success';
      readonly plan: TypeScriptRenderablePostgresMigration;
      readonly warnings?: readonly SqlPlannerConflict[];
    }
  | SqlPlannerFailureResult;

/**
 * Postgres migration planner — a thin wrapper over `planIssues`.
 *
 * `plan()` diffs the target contract against the live schema via the one
 * differ (`buildPostgresPlanDiff`, producing node-typed `SchemaDiffIssue[]`)
 * and delegates to `planIssues` with the unified `postgresPlannerStrategies`
 * list: NOT-NULL backfill, type-change, nullable-tightening, codec-hook
 * storage types, component-declared dependency installs, and
 * shared-temp-default / empty-table-guarded NOT-NULL add-column. The same
 * strategy list runs for `migration plan`, `db update`, and `db init`;
 * behavior diverges purely on `policy.allowedOperationClasses` (the
 * data-safe strategies short-circuit when `'data'` is excluded). The issue
 * planner applies operation-class policy gates and emits a single
 * `PostgresOpFactoryCall[]` that drives both the runtime-ops view (via
 * `renderOps`) and the `renderTypeScript()` authoring surface. RLS policy
 * drift (the structural half of the same one-differ tree) is handled
 * separately via `planPostgresSchemaDiff`.
 */
export class PostgresMigrationPlanner implements MigrationPlanner<'sql', 'postgres'> {
  readonly #lowerer: ExecuteRequestLowerer | undefined;

  constructor(lowerer?: ExecuteRequestLowerer) {
    this.#lowerer = lowerer;
  }

  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    /**
     * The "from" contract (state the planner assumes the database starts
     * at), or `null` for reconciliation flows. Only `migration plan` ever
     * supplies a non-null value; `db update` / `db init` reconcile against
     * the live schema and pass `null`. When present alongside the
     * `'data'` operation class, strategies that need from/to column-shape
     * comparisons (unsafe type change, nullability tightening) activate.
     *
     * Typed as the framework `Contract | null` to satisfy the
     * `MigrationPlanner` interface contract; `planSql` narrows to the SQL
     * shape via `SqlMigrationPlannerPlanOptions`. Used to populate
     * `describe().from` on the produced plan as
     * `fromContract?.storage.storageHash ?? null`.
     */
    readonly fromContract: Contract | null;
    readonly schemaName?: string;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
    /**
     * Contract space this plan applies to. Stamped onto the produced
     * {@link TypeScriptRenderablePostgresMigration.spaceId} so the runner keys
     * the marker row by the right space.
     */
    readonly spaceId: string;
    /**
     * Ownership oracle over the contract-space composition — see
     * {@link SqlMigrationPlannerPlanOptions.ownership}.
     */
    readonly ownership?: SchemaOwnership;
    /**
     * POSIX-relative path from the migration package dir to
     * `migrations/snapshots` — see
     * {@link SqlMigrationPlannerPlanOptions.snapshotsImportPath}.
     */
    readonly snapshotsImportPath: string;
  }): PostgresPlanResult {
    return this.planSql(options as SqlMigrationPlannerPlanOptions);
  }

  emptyMigration(
    context: MigrationScaffoldContext,
    spaceId: string,
  ): MigrationPlanWithAuthoringSurface {
    return new TypeScriptRenderablePostgresMigration(
      [],
      {
        from: context.fromHash,
        to: context.toHash,
      },
      spaceId,
      context.snapshotsImportPath,
      this.#lowerer,
    );
  }

  private planSql(options: SqlMigrationPlannerPlanOptions): PostgresPlanResult {
    const schemaName =
      options.schemaName ??
      Object.keys(options.contract.storage.namespaces).find((id) => id !== UNBOUND_NAMESPACE_ID) ??
      UNBOUND_NAMESPACE_ID;
    const policyResult = this.ensureAdditivePolicy(options.policy);
    if (policyResult) {
      return policyResult;
    }

    // The one combined tree diff drives the whole plan: relational findings
    // become structural DDL via `planIssues`, policy findings become RLS ops
    // via `planPostgresSchemaDiff`. Verify runs its own full-tree node diff
    // (`diffSchema`) over the same schema and rejects on a
    // surviving failure.
    PostgresDatabaseSchemaNode.assert(options.schema);
    const { issues: rawIssues } = buildPostgresPlanDiff({
      contract: options.contract,
      actualSchema: options.schema,
      frameworkComponents: options.frameworkComponents,
    });
    const policyDiffIssues = rawIssues.filter((issue) => isPolicyDiffIssue(issue));
    // Role diff issues resolve to the `external` control policy (see
    // `resolvePostgresNodeIssueControlPolicySubject`'s role branch), so the
    // control-policy partition below suppresses them to zero ops on its own,
    // before `mapNodeIssueToCall` ever sees them — no separate exclusion
    // needed here.
    const relationalDiffIssues = rawIssues.filter((issue) => !isPolicyDiffIssue(issue));

    // The generic differ is total and un-gated: strict-mode extras filtering
    // (dropping `not-expected` findings outside strict mode, mirroring the
    // retired coordinate walk's `if (strict) { ...extra_* } }` guards),
    // subtree coalescing (a missing/extra table also emits an issue for
    // every child under it — redundant once the table-level Create/Drop call
    // already accounts for the whole subtree), and ownership are all post-diff
    // planner steps.
    //
    // Ownership: a live extra is only this plan's to drop when no contract
    // space owns it. The differ ran against THIS space's contract, so a table
    // a sibling space owns surfaces here as `not-expected`; the planner asks
    // the ownership oracle (the passive aggregate) whether any space declares
    // it and, if so, leaves it alone — it is a sibling's table, not an orphan.
    // A table no space owns stays a genuine extra to drop under a destructive
    // policy. Ownership lives in the aggregate; the planner only asks. Absent
    // oracle (single-space, none handed) keeps every extra. Coalescing MUST
    // run before this so a sibling-owned table's child issues have already
    // collapsed into the one table-level issue that carries the table name.
    const strict =
      options.policy.allowedOperationClasses.includes('widening') ||
      options.policy.allowedOperationClasses.includes('destructive');
    const coalesced = coalesceSubtreeIssues(relationalDiffIssues);
    const owned = retainUnownedExtras(coalesced, options.ownership, options.contract);
    const gated = strict ? owned : owned.filter((issue) => issueOutcome(issue) !== 'not-expected');

    // Namespace presence (`CREATE SCHEMA`) is a planner-only op-generation
    // concern stitched in here rather than inside the shared diff — verify
    // never needs it (a missing schema already surfaces as a `not-found`
    // table in the relational findings). These synthesized issues are added
    // AFTER coalescing/scoping (never coalesced against the table diff —
    // their path is an ancestor of every table path under that schema, so
    // running them through the same coalesce would swallow the table-level
    // `not-found` issues that drive `CREATE TABLE`) and are NOT subject to
    // sibling-space scoping, matching the retired coordinate walk exactly.
    const namespaceIssues = verifyPostgresNamespacePresence({
      contract: options.contract,
      schema: options.schema,
    });
    const schemaIssues = [...namespaceIssues, ...gated];

    // Index rename post-pass (the policy pass's structure, generalized): a
    // `not-found` and a `not-expected` index that are one rename collapse
    // into a single widening `ALTER INDEX … RENAME TO` before the per-issue
    // mapping turns them into create + drop. Consumed issues never reach
    // `planIssues`; the rename calls go through the same call-side
    // control-policy partition the policy ops use.
    const indexRenames = this.pairIndexRenames(options, schemaIssues);
    const checkRenames = this.pairCheckRenames(options, schemaIssues);
    const renameConsumed = new Set([...indexRenames.consumed, ...checkRenames.consumed]);
    const plannableIssues =
      renameConsumed.size === 0
        ? schemaIssues
        : schemaIssues.filter((issue) => !renameConsumed.has(issue));

    const codecHooks = extractCodecControlHooks(options.frameworkComponents);
    const storageTypes = options.contract.storage.types ?? {};
    // The strategy layer reads the live schema by bare table name for existence
    // checks (shared-temp-default safety, FK/unique probes), so it takes one
    // per-schema namespace node — never the whole tree root, and never a flat
    // merge of every namespace (which would collide same-named tables across
    // schemas). Probing more than one namespace at once is future work.
    const relationalSchema = relationalNamespaceNode(options.schema, schemaName);

    // Input-side control-policy partition. `external` / `observed` subjects
    // — and non-creation issues for `tolerated` subjects — are dropped from
    // the planner's input entirely; the planner never observes them, never
    // diffs them, never generates DDL for them. Suppression warnings are
    // built directly from the suppressed partition (one per subject), so the
    // user-visible message survives even when the planner would have failed
    // to model the subject's live shape.
    const issuePartition = partitionIssuesByControlPolicy({
      issues: plannableIssues,
      contract: options.contract,
      resolveControlPolicySubject: (issue) =>
        resolvePostgresNodeIssueControlPolicySubject(issue, options.contract),
      resolveCreationFactoryName: resolvePostgresNodeIssueCreationFactoryName,
    });

    const result = planIssues({
      issues: issuePartition.plannable,
      toContract: options.contract,
      // `fromContract` is only supplied by `migration plan`. It is `null` for
      // `db update` / `db init`, which means data-safety strategies needing
      // from/to comparisons (unsafe type change, nullable tightening) are
      // inapplicable there — reconciliation falls through to
      // `mapNodeIssueToCall`'s direct destructive handlers.
      fromContract: options.fromContract,
      schemaName,
      codecHooks,
      storageTypes,
      ...ifDefined('schema', relationalSchema),
      policy: options.policy,
      frameworkComponents: options.frameworkComponents,
      strategies: postgresPlannerStrategies,
    });

    // Relational conflicts and policy-drift conflicts compose into ONE
    // failure so the user sees the complete set in a single round.
    const schemaDiff = this.planPostgresSchemaDiff(options, policyDiffIssues);
    if (!result.ok || schemaDiff.conflicts.length > 0) {
      return plannerFailure([...(result.ok ? [] : result.failure), ...schemaDiff.conflicts]);
    }

    const indexRenamePartition = partitionCallsByControlPolicy({
      calls: [...indexRenames.calls, ...checkRenames.calls],
      contract: options.contract,
      resolveControlPolicySubject: (call) =>
        resolvePostgresCallControlPolicySubject(call, options.contract),
      resolveFactoryName: (call) => call.factoryName,
    });

    const schemaDiffPartition = partitionCallsByControlPolicy({
      calls: schemaDiff.calls,
      contract: options.contract,
      resolveControlPolicySubject: (call) =>
        resolvePostgresCallControlPolicySubject(call, options.contract),
      resolveFactoryName: (call) => call.factoryName,
    });

    // Inline `onFieldEvent`-emitted ops after structural DDL. The fixed
    // ordering is `structural → added → dropped → altered`, with
    // within-group sorting by `(tableName, fieldName)` so re-emits are
    // byte-stable. The hook fires only at the application emitter —
    // extension-space planning never reaches this helper.
    const fieldEventOps = planFieldEventOperations({
      priorContract: options.fromContract,
      newContract: options.contract,
      codecHooks,
    });
    // Codec hook ops are target-agnostic `OpFactoryCall`; Postgres planning
    // lifts them at this integration boundary (see field-event-planner JSDoc).
    const fieldEventPostgresCalls = blindCast<
      readonly PostgresOpFactoryCall[],
      'Codec hook ops conform to PostgresOpFactoryCall at the app emitter boundary'
    >(fieldEventOps);
    const fieldEventPartition = partitionCallsByControlPolicy({
      calls: fieldEventPostgresCalls,
      contract: options.contract,
      resolveControlPolicySubject: (call) =>
        resolvePostgresCallControlPolicySubject(call, options.contract),
      resolveFactoryName: (call) => call.factoryName,
    });
    const calls = [
      ...splicePolicyDropsBeforeEntityDrops(result.value.calls, schemaDiffPartition.kept),
      ...indexRenamePartition.kept,
      ...fieldEventPartition.kept,
    ];
    // Byte-identical suppression warnings (the same subject suppressed by
    // more than one partition) collapse to one; distinct subjects — e.g. a
    // table-level suppression beside a policy-level one naming its
    // rlsPolicy — stay separate.
    const seenWarnings = new Set<string>();
    const warnings: SqlPlannerConflict[] = [
      ...issuePartition.suppressions,
      ...indexRenamePartition.suppressions,
      ...schemaDiff.suppressions,
      ...schemaDiffPartition.suppressions,
      ...fieldEventPartition.suppressions,
    ]
      .map((record) => renderPostgresSuppression(record, options.contract))
      .filter((warning) => {
        const key = JSON.stringify(warning);
        if (seenWarnings.has(key)) return false;
        seenWarnings.add(key);
        return true;
      });

    return Object.freeze({
      kind: 'success' as const,
      plan: new TypeScriptRenderablePostgresMigration(
        calls,
        {
          from: options.fromContract?.storage.storageHash ?? null,
          to: options.contract.storage.storageHash,
        },
        options.spaceId,
        options.snapshotsImportPath,
        this.#lowerer,
      ),
      ...(warnings.length > 0 ? { warnings: Object.freeze(warnings) } : {}),
    });
  }

  /**
   * Rename post-pass for indexes, per `(schema, table)`, widening-only,
   * deterministic by sorted names — the same structure as the policy pass
   * below (which stays untouched: policies pair by hash only).
   *
   * Hash pairing (prefix-only renames): extras whose live names parse as
   * wire names, grouped by `(schema, table, hash)`; missing nodes iterated
   * in sorted-name order consume the sorted-name-first candidate.
   *
   * Content pairing (exact→wire convergence), after hash pairing has
   * consumed its matches: the remaining wire-named-missing nodes
   * (`prefix` defined) against the remaining extras of any name shape,
   * paired iff content-equal (columns ordered-strict both-defined-or-
   * both-undefined, `unique`/`type` strict, `options` loose, bodies
   * byte-equal).
   *
   * Leftovers proceed as create/drop exactly as before; without the
   * widening allowance the pass is skipped and pairing degrades to the
   * additive half, like the policy pass.
   */
  private pairIndexRenames(
    options: PlannerOptionsWithComponents,
    issues: readonly SchemaDiffIssue<SqlSchemaDiffNode>[],
  ): {
    readonly calls: readonly RenameIndexCall[];
    readonly consumed: ReadonlySet<SchemaDiffIssue<SqlSchemaDiffNode>>;
  } {
    const consumed = new Set<SchemaDiffIssue<SqlSchemaDiffNode>>();
    const calls: RenameIndexCall[] = [];
    if (!options.policy.allowedOperationClasses.includes('widening')) {
      return { calls, consumed };
    }

    interface IndexFinding {
      readonly issue: SchemaDiffIssue<SqlSchemaDiffNode>;
      readonly node: SqlIndexIR;
      readonly ddlSchema: string;
      readonly tableName: string;
    }
    const missing: IndexFinding[] = [];
    const extra: IndexFinding[] = [];
    for (const issue of issues) {
      const node = issueNode(issue);
      if (node === undefined || !SqlIndexIR.is(node)) continue;
      const ddlSchema = issue.path[1];
      const tableName = issue.path[2];
      if (ddlSchema === undefined || tableName === undefined) continue;
      if (issueOutcome(issue) === 'not-found') {
        missing.push({ issue, node, ddlSchema, tableName });
      } else if (issueOutcome(issue) === 'not-expected') {
        extra.push({ issue, node, ddlSchema, tableName });
      }
    }
    if (missing.length === 0 || extra.length === 0) {
      return { calls, consumed };
    }

    const byName = (a: IndexFinding, b: IndexFinding): number =>
      a.node.name < b.node.name ? -1 : a.node.name > b.node.name ? 1 : 0;
    // DDL emission must stay unqualified for the unbound namespace, exactly
    // like the per-issue mapping's `emissionSchemaName`.
    const emissionSchema = (ddlSchema: string): string =>
      resolveNamespaceIdForDdlSchema(options.contract, ddlSchema) === UNBOUND_NAMESPACE_ID
        ? UNBOUND_NAMESPACE_ID
        : ddlSchema;
    const pairingKey = (finding: IndexFinding, hash: string): string =>
      JSON.stringify([finding.ddlSchema, finding.tableName, hash]);
    const rename = (missingFinding: IndexFinding, candidate: IndexFinding): void => {
      consumed.add(missingFinding.issue);
      consumed.add(candidate.issue);
      calls.push(
        new RenameIndexCall(
          emissionSchema(missingFinding.ddlSchema),
          missingFinding.tableName,
          candidate.node.name,
          missingFinding.node.name,
        ),
      );
    };

    const sortedMissing = [...missing].sort(byName);

    const extrasByHash = new Map<string, IndexFinding[]>();
    for (const finding of extra) {
      const parsed = parseWireName(finding.node.name);
      if (parsed === undefined) continue;
      const key = pairingKey(finding, parsed.hash);
      const group = extrasByHash.get(key) ?? [];
      group.push(finding);
      extrasByHash.set(key, group);
    }
    for (const group of extrasByHash.values()) {
      group.sort(byName);
    }
    for (const missingFinding of sortedMissing) {
      const parsed = parseWireName(missingFinding.node.name);
      if (parsed === undefined) continue;
      const candidate = extrasByHash.get(pairingKey(missingFinding, parsed.hash))?.shift();
      if (candidate === undefined) continue;
      rename(missingFinding, candidate);
    }

    const sortedExtras = [...extra].sort(byName);
    for (const missingFinding of sortedMissing) {
      if (consumed.has(missingFinding.issue)) continue;
      if (missingFinding.node.prefix === undefined) continue;
      const candidate = sortedExtras.find(
        (extraFinding) =>
          !consumed.has(extraFinding.issue) &&
          extraFinding.ddlSchema === missingFinding.ddlSchema &&
          extraFinding.tableName === missingFinding.tableName &&
          missingFinding.node.contentEquals(extraFinding.node, {
            columnPresence: 'matching',
            bodies: 'verbatim',
          }),
      );
      if (candidate === undefined) continue;
      rename(missingFinding, candidate);
    }

    return { calls, consumed };
  }

  /**
   * Check-constraint rename post-pass: a `not-found` and a `not-expected`
   * check on the same table whose wire-name content hashes match but whose
   * prefixes differ is a prefix-only rename, and collapses into one
   * `ALTER TABLE … RENAME CONSTRAINT`.
   *
   * This is the index pass's hash-pairing phase and nothing else. There is
   * deliberately no content-pairing phase: a live check body is whatever
   * Postgres reprinted, so it never byte-matches the authored text, and
   * pairing an exact-named live check by content would bless whatever
   * predicate is actually live. Adoption of an old exact-named check stays
   * drop + add.
   *
   * Runs only when the policy allows `widening` (rename's class). Without it
   * the pass no-ops and the pair degrades to the slice-1 behavior: an add,
   * plus a drop when `destructive` is allowed too.
   */
  private pairCheckRenames(
    options: PlannerOptionsWithComponents,
    issues: readonly SchemaDiffIssue<SqlSchemaDiffNode>[],
  ): {
    readonly calls: readonly RenameCheckConstraintCall[];
    readonly consumed: ReadonlySet<SchemaDiffIssue<SqlSchemaDiffNode>>;
  } {
    const consumed = new Set<SchemaDiffIssue<SqlSchemaDiffNode>>();
    const calls: RenameCheckConstraintCall[] = [];
    if (!options.policy.allowedOperationClasses.includes('widening')) {
      return { calls, consumed };
    }

    interface CheckFinding {
      readonly issue: SchemaDiffIssue<SqlSchemaDiffNode>;
      readonly node: SqlCheckConstraintIR;
      readonly ddlSchema: string;
      readonly tableName: string;
    }
    const missing: CheckFinding[] = [];
    const extra: CheckFinding[] = [];
    for (const issue of issues) {
      const node = issueNode(issue);
      if (node === undefined || !SqlCheckConstraintIR.is(node)) continue;
      const ddlSchema = issue.path[1];
      const tableName = issue.path[2];
      if (ddlSchema === undefined || tableName === undefined) continue;
      if (issueOutcome(issue) === 'not-found') {
        missing.push({ issue, node, ddlSchema, tableName });
      } else if (issueOutcome(issue) === 'not-expected') {
        extra.push({ issue, node, ddlSchema, tableName });
      }
    }
    if (missing.length === 0 || extra.length === 0) {
      return { calls, consumed };
    }

    const byName = (a: CheckFinding, b: CheckFinding): number =>
      a.node.name < b.node.name ? -1 : a.node.name > b.node.name ? 1 : 0;
    // DDL emission must stay unqualified for the unbound namespace, exactly
    // like the per-issue mapping's `emissionSchemaName`.
    const emissionSchema = (ddlSchema: string): string =>
      resolveNamespaceIdForDdlSchema(options.contract, ddlSchema) === UNBOUND_NAMESPACE_ID
        ? UNBOUND_NAMESPACE_ID
        : ddlSchema;
    const pairingKey = (finding: CheckFinding, hash: string): string =>
      JSON.stringify([finding.ddlSchema, finding.tableName, hash]);

    const sortedMissing = [...missing].sort(byName);

    const extrasByHash = new Map<string, CheckFinding[]>();
    for (const finding of extra) {
      const parsed = parseWireName(finding.node.name);
      if (parsed === undefined) continue;
      const key = pairingKey(finding, parsed.hash);
      const group = extrasByHash.get(key) ?? [];
      group.push(finding);
      extrasByHash.set(key, group);
    }
    for (const group of extrasByHash.values()) {
      group.sort(byName);
    }
    for (const missingFinding of sortedMissing) {
      const parsed = parseWireName(missingFinding.node.name);
      if (parsed === undefined) continue;
      const candidate = extrasByHash.get(pairingKey(missingFinding, parsed.hash))?.shift();
      if (candidate === undefined) continue;
      consumed.add(missingFinding.issue);
      consumed.add(candidate.issue);
      calls.push(
        new RenameCheckConstraintCall(
          emissionSchema(missingFinding.ddlSchema),
          missingFinding.tableName,
          candidate.node.name,
          missingFinding.node.name,
        ),
      );
    }

    return { calls, consumed };
  }

  /**
   * Maps the RLS policy findings of the one combined tree diff
   * (`buildPostgresPlanDiff`, already ownership-filtered) into
   * `CREATE POLICY` / `DROP POLICY` / `ALTER POLICY … RENAME TO` ops — a
   * `not-equal` finding (an exact-named policy whose content drifted)
   * becomes drop + create, or a disallowed-call conflict when the policy
   * forbids the destructive drop. It
   * does not re-diff — it consumes exactly the policy-node subset of the
   * shared diff's issues. Enablement is NOT decided here: `ENABLE`/`DISABLE
   * ROW LEVEL SECURITY` derive from the table's marker-driven `rlsEnabled`
   * attribute diff on the relational side.
   *
   * Rename post-pass (the index pass's structure): hash pairing pairs a
   * `not-found` and a `not-expected` policy on the SAME table whose
   * wire-name content hashes match but prefixes differ (prefix-only rename);
   * content pairing then pairs remaining wire-named-missing policies against remaining
   * extras of any name shape by verbatim content (the node-owned `contentEquals` —
   * exact→wire adoption). Multi-candidate groups pair deterministically
   * by sorted name; leftovers proceed as create/drop; an exact-named
   * missing policy never content-pairs.
   *
   * The pairing runs only when the policy allows `widening` (rename's
   * class). Without it (db-init's additive-only set), pairing degrades
   * deliberately to the additive half: the new name is CREATEd and the old
   * policy survives live until a widening/destructive-allowed plan runs —
   * emitting an ungated widening rename would only fail at the runner's
   * class re-enforcement.
   */
  private planPostgresSchemaDiff(
    options: PlannerOptionsWithComponents,
    filteredDiffIssues: readonly SchemaDiffIssue<SqlSchemaDiffNode>[],
  ): {
    readonly calls: readonly PostgresOpFactoryCall[];
    readonly conflicts: readonly SqlPlannerConflict[];
    readonly suppressions: readonly SuppressionRecord[];
  } {
    const allowsDestructive = options.policy.allowedOperationClasses.includes('destructive');
    const allowsWidening = options.policy.allowedOperationClasses.includes('widening');

    interface PolicyFinding {
      readonly node: PostgresPolicySchemaNode;
      readonly schemaForTable: string;
    }
    const missing: PolicyFinding[] = [];
    const extra: PolicyFinding[] = [];
    const changed: PolicyFinding[] = [];

    for (const issue of filteredDiffIssues) {
      // 'not-equal' is reachable for exact-named (prefix-absent) policies:
      // their isEqualTo compares content, so a same-named live policy with a
      // drifted body pairs by name and fails equality. Wire-named policies never
      // produce it — the wire name encodes the body hash, so name-equality is
      // body-equality.
      if (issueOutcome(issue) === 'not-equal') {
        const expected = issue.expected;
        PostgresPolicySchemaNode.assert(expected);
        changed.push({
          node: expected,
          schemaForTable: resolveDdlSchemaForNamespaceStorage(
            options.contract.storage,
            expected.namespaceId,
          ),
        });
      } else if (issueOutcome(issue) === 'not-found') {
        const expected = issue.expected;
        PostgresPolicySchemaNode.assert(expected);
        // expected.namespaceId is the DDL schema name (resolved during projection);
        // this re-resolution is a no-op as long as PostgresSchema.ddlSchemaName() returns this.id.
        missing.push({
          node: expected,
          schemaForTable: resolveDdlSchemaForNamespaceStorage(
            options.contract.storage,
            expected.namespaceId,
          ),
        });
      } else if (issueOutcome(issue) === 'not-expected') {
        const actual = issue.actual;
        PostgresPolicySchemaNode.assert(actual);
        extra.push({
          node: actual,
          schemaForTable: resolveDdlSchemaForNamespaceStorage(
            options.contract.storage,
            actual.namespaceId,
          ),
        });
      }
    }

    const calls: PostgresOpFactoryCall[] = [];
    const conflicts: SqlPlannerConflict[] = [];
    const suppressions: SuppressionRecord[] = [];
    const renamedExtras = new Set<PolicyFinding>();
    const renamedMissing = new Set<PolicyFinding>();
    const pairingKey = (finding: PolicyFinding, hash: string): string =>
      JSON.stringify([finding.schemaForTable, finding.node.tableName, hash]);

    if (allowsWidening) {
      const extrasByGroup = new Map<string, PolicyFinding[]>();
      for (const finding of extra) {
        const parsed = parseWireName(finding.node.name);
        if (parsed === undefined) continue;
        const key = pairingKey(finding, parsed.hash);
        const group = extrasByGroup.get(key) ?? [];
        group.push(finding);
        extrasByGroup.set(key, group);
      }
      for (const group of extrasByGroup.values()) {
        group.sort((a, b) => (a.node.name < b.node.name ? -1 : a.node.name > b.node.name ? 1 : 0));
      }

      const sortedMissing = [...missing].sort((a, b) =>
        a.node.name < b.node.name ? -1 : a.node.name > b.node.name ? 1 : 0,
      );
      for (const missingFinding of sortedMissing) {
        const parsed = parseWireName(missingFinding.node.name);
        if (parsed === undefined) continue;
        const candidates = extrasByGroup.get(pairingKey(missingFinding, parsed.hash));
        const candidate = candidates?.shift();
        if (candidate === undefined) continue;
        // Same name would never surface as missing+extra (the differ pairs by
        // name), so a matched candidate always differs in prefix only.
        renamedExtras.add(candidate);
        renamedMissing.add(missingFinding);
        calls.push(
          new RenamePostgresRlsPolicyCall(
            missingFinding.schemaForTable,
            missingFinding.node.tableName,
            candidate.node.name,
            missingFinding.node.name,
          ),
        );
      }

      // Content pairing (exact→wire convergence), after hash pairing
      // has consumed its matches: a
      // remaining wire-named-missing policy pairs with a remaining
      // extra of ANY name shape when the content matches verbatim
      // (the node-owned `contentEquals` — not the normalized hash tuple). This is how
      // replacing `@@map` with the plain head converges as one
      // `ALTER POLICY … RENAME`. Deterministic like the index pass: missing
      // already iterates sorted by name, candidates consume sorted by name.
      const sortedExtras = [...extra].sort((a, b) =>
        a.node.name < b.node.name ? -1 : a.node.name > b.node.name ? 1 : 0,
      );
      for (const missingFinding of sortedMissing) {
        if (renamedMissing.has(missingFinding)) continue;
        if (missingFinding.node.prefix === undefined) continue;
        const candidate = sortedExtras.find(
          (extraFinding) =>
            !renamedExtras.has(extraFinding) &&
            extraFinding.schemaForTable === missingFinding.schemaForTable &&
            extraFinding.node.tableName === missingFinding.node.tableName &&
            missingFinding.node.contentEquals(extraFinding.node),
        );
        if (candidate === undefined) continue;
        renamedExtras.add(candidate);
        renamedMissing.add(missingFinding);
        calls.push(
          new RenamePostgresRlsPolicyCall(
            missingFinding.schemaForTable,
            missingFinding.node.tableName,
            candidate.node.name,
            missingFinding.node.name,
          ),
        );
      }
    }

    // A changed (not-equal) policy is repaired as a PolicyReplacement —
    // DROP then CREATE under one physical name, graded as one unit by
    // gradePolicyReplacement before it becomes calls or a conflict.
    for (const finding of changed) {
      const replacement: PolicyReplacement = {
        drop: new DropPostgresRlsPolicyCall(
          finding.schemaForTable,
          finding.node.tableName,
          finding.node.name,
        ),
        create: new CreatePostgresRlsPolicyCall(
          finding.schemaForTable,
          finding.node.tableName,
          policyNodeToContractPolicy(finding.node),
        ),
      };
      const graded = gradePolicyReplacement(
        replacement,
        options.contract,
        options.policy.allowedOperationClasses,
      );
      if (graded.disposition === 'suppress') {
        suppressions.push(graded.record);
        continue;
      }
      if (graded.disposition === 'conflict') {
        conflicts.push(graded.conflict);
        continue;
      }
      calls.push(replacement.drop);
      calls.push(replacement.create);
    }

    for (const finding of missing) {
      if (renamedMissing.has(finding)) continue;
      calls.push(
        new CreatePostgresRlsPolicyCall(
          finding.schemaForTable,
          finding.node.tableName,
          policyNodeToContractPolicy(finding.node),
        ),
      );
    }
    if (allowsDestructive) {
      for (const finding of extra) {
        if (renamedExtras.has(finding)) continue;
        calls.push(
          new DropPostgresRlsPolicyCall(
            finding.schemaForTable,
            finding.node.tableName,
            finding.node.name,
          ),
        );
      }
    }

    return { calls, conflicts, suppressions };
  }

  private ensureAdditivePolicy(policy: MigrationOperationPolicy) {
    if (!policy.allowedOperationClasses.includes('additive')) {
      return plannerFailure([
        {
          kind: 'unsupportedOperation',
          summary: 'Migration planner requires additive operations be allowed',
          why: 'The planner requires the "additive" operation class to be allowed in the policy.',
        },
      ]);
    }
    return null;
  }
}

/**
 * A diff issue whose node is an RLS policy — the structural half of the one
 * combined tree diff, routed to `planPostgresSchemaDiff` instead of
 * `planIssues`.
 */
function isPolicyDiffIssue(issue: SchemaDiffIssue<SqlSchemaDiffNode>): boolean {
  const node = issue.expected ?? issue.actual;
  return node !== undefined && PostgresPolicySchemaNode.is(node);
}

/**
 * Splices RLS policy drops ahead of structural entity drops. Postgres refuses
 * to drop a column (or table) while a policy still references it (2BP01), so
 * a `dropColumn` planned before its `dropPolicy` fails at apply time. Policy
 * creates and renames stay after the structural block: creates must see the
 * columns they reference, and renames preserve policies rather than removing
 * them. With no entity drop present the input order is kept untouched.
 */
function splicePolicyDropsBeforeEntityDrops(
  structural: readonly PostgresOpFactoryCall[],
  schemaDiff: readonly PostgresOpFactoryCall[],
): readonly PostgresOpFactoryCall[] {
  const policyDrops = schemaDiff.filter(
    (call): call is DropPostgresRlsPolicyCall => call instanceof DropPostgresRlsPolicyCall,
  );
  const anchor =
    policyDrops.length === 0
      ? -1
      : structural.findIndex(
          (call) => call instanceof DropTableCall || call instanceof DropColumnCall,
        );
  if (anchor === -1) {
    return [...structural, ...schemaDiff];
  }
  const rest = schemaDiff.filter((call) => !(call instanceof DropPostgresRlsPolicyCall));
  return [...structural.slice(0, anchor), ...policyDrops, ...structural.slice(anchor), ...rest];
}

/**
 * Drops a `not-expected` issue when it is a whole extra storage entity (a table
 * or a native enum) that some space in the composition owns. Each such node
 * yields its own storage coordinate (see {@link postgresNodeStorageCoordinate}),
 * so `declaresEntity` answers over the whole composition on one uniform
 * coordinate: a positive answer means a sibling owns this entity here — leave
 * it; a negative answer means a genuine orphan — drop it. A node with no storage
 * coordinate (a namespace, or a deeper column/constraint drift on an owned
 * table) is this space's own and is always kept. No oracle ⇒ keep everything.
 */
function retainUnownedExtras(
  issues: readonly SchemaDiffIssue<SqlSchemaDiffNode>[],
  ownership: SchemaOwnership | undefined,
  contract: Contract<SqlStorage>,
): readonly SchemaDiffIssue<SqlSchemaDiffNode>[] {
  if (ownership === undefined) return issues;
  return issues.filter((issue) => {
    if (issueOutcome(issue) !== 'not-expected') return true;
    const node = issueNode(issue);
    if (node === undefined) return true;
    const coordinate = postgresNodeStorageCoordinate(node);
    if (coordinate === undefined) return true;
    const ddlSchemaName = issueSchemaName(issue);
    if (ddlSchemaName === undefined) return true;
    const namespaceId = resolveNamespaceIdForDdlSchema(contract, ddlSchemaName);
    return !ownership.declaresEntity({ namespaceId, ...coordinate });
  });
}

/**
 * Returns the one namespace node the relational strategy layer probes for
 * live-table existence and reads codec-hook context off — the namespace
 * matching the planner's resolved schema name, or the first namespace when
 * none matches. `undefined` when the tree has no namespaces, so the strategy
 * context uses its empty-schema default.
 *
 * The relational strategies key tables by bare name, so they can only probe one
 * namespace at a time; probing across every namespace at once is future work.
 *
 * Returns the real `PostgresNamespaceSchemaNode` reference rather than a
 * projection: `storageTypePlanCallStrategy` hands this same value to codec
 * `planTypeOperations` hooks as `schema`, and hooks read the Postgres-specific
 * `nativeEnums` field off it (via `PostgresNamespaceSchemaNode.is`) to decide
 * whether a native enum type already exists — a projection that only copies
 * `tables` would silently drop that signal. `StrategyContext.schema`'s
 * declared type (`SqlSchemaIR`, shared with SQLite's flat shape) doesn't
 * capture this, so the return is `blindCast` the same way `namespaceSchemaNodes`
 * in the family's relational walk already treats a namespace node as a
 * structurally-`SqlSchemaIR`-shaped value.
 */
function relationalNamespaceNode(
  schema: PostgresDatabaseSchemaNode,
  schemaName: string,
): SqlSchemaIR | undefined {
  const namespaceNodes = Object.values(schema.namespaces);
  const namespaceNode =
    namespaceNodes.find((node) => node.schemaName === schemaName) ?? namespaceNodes[0];
  if (namespaceNode === undefined) return undefined;
  return blindCast<
    SqlSchemaIR,
    'PostgresNamespaceSchemaNode carries tables (+ nativeEnums, read by codec hooks via PostgresNamespaceSchemaNode.is) structurally compatible with the SqlSchemaIR shape the strategy layer declares'
  >(namespaceNode);
}

/**
 * A drifted exact-named policy's repair: DROP then CREATE under ONE
 * physical name. The two calls are one unit — splitting them (suppressing
 * the drop, keeping the create) yields a plan whose create fails its own
 * "policy does not exist" precheck at apply time.
 */
interface PolicyReplacement {
  readonly drop: DropPostgresRlsPolicyCall;
  readonly create: CreatePostgresRlsPolicyCall;
}

type PolicyReplacementDisposition =
  | { readonly disposition: 'plan' }
  | { readonly disposition: 'suppress'; readonly record: SuppressionRecord }
  | { readonly disposition: 'conflict'; readonly conflict: SqlPlannerConflict };

/**
 * Grades a {@link PolicyReplacement} as one unit against the table's
 * control policy, BEFORE the pair becomes calls or a conflict. This runs
 * ahead of `partitionCallsByControlPolicy`, which later re-grades the
 * surviving calls per-call — a no-op here, since only managed units
 * survive this grading.
 *
 * A replacement is deliberately STRICTER than the shared
 * `callAllowedUnderControlPolicy` rule: `tolerated` permits whole-object
 * creation, but a replacement's create is the second half of a repair of
 * an existing object, not a new object — so ANY non-managed control
 * (external, observed, tolerated) suppresses the whole unit. Drift on an
 * object the plan does not manage is reported, never repaired; the
 * suppression subject names the drifted policy (`rlsPolicy`) so the
 * report says which policy drifted, matching the conflict path's
 * `location.rlsPolicy`.
 */
function gradePolicyReplacement(
  replacement: PolicyReplacement,
  contract: Contract<SqlStorage>,
  allowedOperationClasses: readonly MigrationOperationClass[],
): PolicyReplacementDisposition {
  const subject = resolvePostgresCallControlPolicySubject(replacement.drop, contract);
  const controlPolicy = controlPolicyForCall(subject, contract.defaultControlPolicy);
  if (controlPolicy !== 'managed') {
    return {
      disposition: 'suppress',
      record: {
        subject:
          subject === undefined
            ? undefined
            : { ...subject, rlsPolicy: replacement.drop.policyName },
        policy: controlPolicy,
        factoryName: undefined,
        createsNewObject: false,
      },
    };
  }
  if (!allowedOperationClasses.includes('destructive')) {
    return {
      disposition: 'conflict',
      conflict: conflictForDisallowedCall(replacement.drop, allowedOperationClasses),
    };
  }
  return { disposition: 'plan' };
}

/**
 * Rebuilds the `PostgresRlsPolicy` contract entity `CreatePostgresRlsPolicyCall`
 * carries (its `renderTypeScript`/`createRlsPolicy` paths serialize the whole
 * entity, `namespaceId` included). This reconstructs rather than looking the
 * original up in the contract on purpose: the diff node's `namespaceId` is the
 * *resolved DDL schema* (set when the expected tree was built), which is the
 * value the emitted op must carry; the contract-stored entity holds the raw,
 * pre-resolution coordinate, so a lookup would change the migration output.
 */
function policyNodeToContractPolicy(node: PostgresPolicySchemaNode): PostgresRlsPolicy {
  return new PostgresRlsPolicy({
    naming: namingOf(node.name, node.prefix),
    tableName: node.tableName,
    namespaceId: node.namespaceId,
    operation: node.operation,
    roles: [...node.roles],
    using: node.using,
    withCheck: node.withCheck,
    permissive: node.permissive,
  });
}
