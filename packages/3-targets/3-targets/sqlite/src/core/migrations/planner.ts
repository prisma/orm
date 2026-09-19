import type { Contract } from '@internal/contract/types';
import type {
  MigrationOperationPolicy,
  SqlMigrationPlanner,
  SqlMigrationPlannerPlanOptions,
  SqlPlannerFailureResult,
} from '@internal/family-sql/control';
import {
  detectTableNameCaseChanges,
  extractCodecControlHooks,
  planFieldEventOperations,
  plannerFailure,
} from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import type {
  MigrationPlanner,
  MigrationScaffoldContext,
  SchemaDiffIssue,
  SchemaOwnership,
} from '@internal/framework-components/control';
import { issueOutcome } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  RelationalSchemaNodeKind,
  type SqlSchemaIR,
  SqlTableIR,
} from '@internal/sql-schema-ir/types';
import { buildSqlitePlanDiff } from './diff-database-schema';
import { coalesceSubtreeIssues, issueNode, planIssues } from './issue-planner';
import {
  type SqliteMigrationDestinationInfo,
  TypeScriptRenderableSqliteMigration,
} from './planner-produced-sqlite-migration';
import { sqlitePlannerStrategies } from './planner-strategies';
import type { SqlitePlanTargetDetails } from './planner-target-details';

export function createSqliteMigrationPlanner(
  lowerer: ExecuteRequestLowerer,
): SqliteMigrationPlanner {
  return new SqliteMigrationPlanner(lowerer);
}

export type SqlitePlanResult =
  | { readonly kind: 'success'; readonly plan: TypeScriptRenderableSqliteMigration }
  | SqlPlannerFailureResult;

/**
 * SQLite migration planner — a thin wrapper over `planIssues`.
 *
 * `plan()` diffs the live schema against the target contract via the one
 * differ (`buildSqlitePlanDiff`, producing node-typed `SchemaDiffIssue[]`)
 * and delegates to `planIssues` with the registered strategies. Strategies
 * absorb groups of related issues into composite recipes (e.g. recreating a
 * table to apply type/nullability/default/constraint changes at once);
 * anything not absorbed by a strategy flows through `mapNodeIssueToCall` in
 * the issue planner as a one-off call.
 *
 * FK-backing indexes are already merged into the expected table node's
 * `indexes` at derivation (`contractToSchemaIR`'s `convertTable`), so
 * `mapNodeIssueToCall` handles them uniformly alongside user-declared
 * indexes — no separate expansion step in the planner.
 */
export class SqliteMigrationPlanner
  implements SqlMigrationPlanner<SqlitePlanTargetDetails>, MigrationPlanner<'sql', 'sqlite'>
{
  readonly #lowerer: ExecuteRequestLowerer;

  constructor(lowerer: ExecuteRequestLowerer) {
    this.#lowerer = lowerer;
  }

  plan(options: {
    readonly contract: unknown;
    readonly schema: unknown;
    readonly policy: MigrationOperationPolicy;
    /**
     * The "from" contract (state the planner assumes the database starts at),
     * or `null` for reconciliation flows.
     *
     * Typed as the framework `Contract | null` to satisfy the
     * `MigrationPlanner` interface contract; `planSql` narrows to the SQL
     * shape via `SqlMigrationPlannerPlanOptions`. Used to populate
     * `describe().from` on the produced plan as
     * `fromContract?.storage.storageHash ?? null`.
     */
    readonly fromContract: Contract | null;
    readonly frameworkComponents: ReadonlyArray<TargetBoundComponentDescriptor<'sql', string>>;
    /**
     * Contract space this plan applies to. Stamped onto the produced
     * {@link TypeScriptRenderableSqliteMigration.spaceId} so the runner keys
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
  }): SqlitePlanResult {
    return this.planSql(options as SqlMigrationPlannerPlanOptions);
  }

  emptyMigration(
    context: MigrationScaffoldContext,
    spaceId: string,
  ): TypeScriptRenderableSqliteMigration {
    return new TypeScriptRenderableSqliteMigration(
      [],
      {
        from: context.fromHash,
        to: context.toHash,
      },
      spaceId,
      context.snapshotsImportPath,
      undefined,
      this.#lowerer,
    );
  }

  private planSql(options: SqlMigrationPlannerPlanOptions): SqlitePlanResult {
    const policyResult = this.ensureAdditivePolicy(options.policy);
    if (policyResult) return policyResult;

    const { expected, actual, issues } = this.collectSchemaIssues(options);
    const caseChangeConflicts = detectTableNameCaseChanges({
      issues,
      tableOf: (issue) => {
        const node = issueNode(issue);
        return node instanceof SqlTableIR ? node : undefined;
      },
      namespaceIdOf: () => UNBOUND_NAMESPACE_ID,
    });
    if (caseChangeConflicts.length > 0) {
      return plannerFailure(caseChangeConflicts);
    }
    const codecHooks = extractCodecControlHooks(options.frameworkComponents);

    const result = planIssues({
      issues,
      expected,
      actual,
      policy: options.policy,
      frameworkComponents: options.frameworkComponents,
      strategies: sqlitePlannerStrategies,
    });

    if (!result.ok) {
      return plannerFailure(result.failure);
    }

    // Codec lifecycle hook (T2.2): inline `onFieldEvent`-emitted ops after
    // structural DDL. Sub-spec § 5 fixes the ordering as
    // `structural → added → dropped → altered`, with within-group sorting by
    // `(tableName, fieldName)` deterministic for byte-stable re-emits.
    // Hook fires only at the application emitter — extension-space planning
    // (M2 R2) never reaches this helper.
    const fieldEventOps = planFieldEventOperations({
      priorContract: options.fromContract,
      newContract: options.contract,
      codecHooks,
    });
    // Codec-emitted calls already conform to `OpFactoryCall` — render +
    // toOp + importRequirements ride directly through the same emit path
    // as structural ops, no `RawSqlCall` wrap.
    const calls = [...result.value.calls, ...fieldEventOps];

    const destination: SqliteMigrationDestinationInfo = {
      storageHash: options.contract.storage.storageHash,
      ...(options.contract.profileHash !== undefined
        ? { profileHash: options.contract.profileHash }
        : {}),
    };

    return {
      kind: 'success' as const,
      plan: new TypeScriptRenderableSqliteMigration(
        calls,
        {
          from: options.fromContract?.storage.storageHash ?? null,
          to: options.contract.storage.storageHash,
        },
        options.spaceId,
        options.snapshotsImportPath,
        destination,
        this.#lowerer,
      ),
    };
  }

  private ensureAdditivePolicy(policy: MigrationOperationPolicy): SqlPlannerFailureResult | null {
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

  /**
   * Diffs the target contract against the live schema via the one differ
   * (the same tree-building `diffSqliteSchema` uses, plus the
   * op-render stamper) and prepares the issue list `planIssues` consumes.
   *
   * Three passes, in order:
   * 1. Subtree coalescing — the differ is total (a missing/extra table also
   *    emits an issue for every column/constraint under it); those nested
   *    issues are redundant once the table-level `CreateTable`/`DropTable`
   *    call already accounts for the whole subtree. Runs FIRST, over the
   *    complete diff: a sibling-owned extra table's column issues must
   *    collapse into its one table-level issue before the ownership pass,
   *    because a bare column node carries no table reference — if coalescing
   *    ran after ownership dropped the table-level issue, the orphaned column
   *    issues would survive and the planner would emit drops against a
   *    sibling space's table.
   * 2. Ownership — a live extra is only this plan's to drop when no contract
   *    space owns it. The differ ran against THIS space's contract, so a
   *    table a sibling owns surfaces here as `not-expected`; the planner asks
   *    the ownership oracle (the passive aggregate) whether any space declares
   *    it and, if so, leaves it alone. A table no space owns stays a genuine
   *    extra. Ownership lives in the aggregate; the planner only asks. No
   *    oracle (single-space) keeps every extra.
   * 3. Strict-mode extras gating — `not-expected` (extra table/column/
   *    constraint) issues are dropped entirely outside strict mode, mirroring
   *    the retired coordinate walk's `if (strict) { ...extra_* } }` guards:
   *    an additive-only plan must never even consider dropping an unclaimed
   *    object, not just refuse to emit the drop.
   */
  private collectSchemaIssues(options: SqlMigrationPlannerPlanOptions): {
    readonly expected: SqlSchemaIR;
    readonly actual: SqlSchemaIR;
    readonly issues: readonly SchemaDiffIssue[];
  } {
    const allowed = options.policy.allowedOperationClasses;
    const strict = allowed.includes('widening') || allowed.includes('destructive');
    const {
      expected,
      actual,
      issues: rawIssues,
    } = buildSqlitePlanDiff({
      contract: options.contract,
      actualSchema: options.schema,
      frameworkComponents: options.frameworkComponents,
    });
    const coalesced = coalesceSubtreeIssues(rawIssues);
    const owned = retainUnownedExtras(coalesced, options.ownership);
    const issues = strict ? owned : owned.filter((issue) => issueOutcome(issue) !== 'not-expected');
    return { expected, actual, issues };
  }
}

/**
 * Drops a `not-expected` issue when it is a whole extra TABLE that some
 * contract space owns, asking the ownership oracle per node.
 *
 * The consultation applies ONLY to table-level extras — a live table this
 * space's contract lacks — identified by asking the issue's own node
 * (`nodeKind === table`), never by counting path segments. SQLite is a
 * single-namespace target, so every coordinate is qualified with the shared
 * `UNBOUND_NAMESPACE_ID` sentinel (the same one the aggregate's declared
 * entities carry for this target). `entityKind` is the literal `'table'`:
 * this function only ever asks about a node already confirmed to be
 * `RelationalSchemaNodeKind.table` (checked just above), and that's a
 * diff-tree `nodeKind` spelling (`'sql-table'`) distinct from the storage
 * `entries` vocabulary `elementCoordinates` walks (`'table'`) — the literal
 * is that storage-entries spelling. `declaresEntity` answers over the whole
 * composition (self included), so a positive answer on such a table means
 * another space owns it (a table this space owned would be in its expected
 * tree, never an extra): leave it. A negative answer means no space owns
 * it — a genuine orphan to drop.
 *
 * A DEEPER extra (an extra column/constraint on a table this space DOES own —
 * only the child drifted, so the table is in the expected tree) is this
 * space's own drift and is always kept for dropping; asking the oracle there
 * would wrongly suppress it, because the owned table answers `true`. No oracle
 * ⇒ every extra is kept (single-space plan).
 */
function retainUnownedExtras(
  issues: readonly SchemaDiffIssue[],
  ownership: SchemaOwnership | undefined,
): readonly SchemaDiffIssue[] {
  if (ownership === undefined) return issues;
  return issues.filter((issue) => {
    if (issueOutcome(issue) !== 'not-expected') return true;
    const node = issueNode(issue);
    if (node === undefined || node.nodeKind !== RelationalSchemaNodeKind.table) return true;
    const tableName = issue.path[1];
    return (
      tableName === undefined ||
      !ownership.declaresEntity({
        namespaceId: UNBOUND_NAMESPACE_ID,
        entityKind: 'table',
        entityName: tableName,
      })
    );
  });
}
