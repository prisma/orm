/**
 * Planner-produced Postgres migration.
 *
 * Returned by `PostgresMigrationPlanner.plan(...)` and `emptyMigration(...)`.
 * Holds the migration IR (`PostgresOpFactoryCall[]`) alongside
 * `MigrationMeta` and exposes both the runtime-ops view (`get operations`)
 * and the TypeScript authoring view (`renderTypeScript()`). Satisfies
 * `MigrationPlanWithAuthoringSurface` so the CLI can uniformly serialize any
 * planner result back to `migration.ts`.
 *
 * Extends the family-level `SqlMigration` alias rather than the target-local
 * migration base directly — mirrors Mongo's `PlannerProducedMongoMigration`
 * shape and keeps CLI wiring one step removed from target internals.
 *
 * Placeholder-bearing plans: `renderTypeScript()` always succeeds and embeds
 * `() => placeholder("slot")` at each stub. `operations`, in contrast, holds a promise that
 * rejects with `MIGRATION.UNFILLED_PLACEHOLDER` for each stub, because a planner-stubbed closure
 * cannot be lowered to a runtime op; the other operations resolve. Callers that know a plan may carry stubs must render to
 * `migration.ts`, let the user fill the slots, and re-load the edited
 * migration before enumerating ops. The walk-schema planner does not emit
 * `DataTransformCall`s today, so this asymmetry is invisible until the
 * issue-planner integration lands in Phase 2.
 */

import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type {
  MigrationPlanWithAuthoringSurface,
  OpFactoryCall,
} from '@internal/framework-components/control';
import type { ImportSpecifierResolver } from '@internal/framework-components/emission';
import type { MigrationMeta } from '@internal/migration-tools/migration';
import type { PostgresPlanTargetDetails } from './planner-target-details';
import { PostgresMigration } from './postgres-migration';
import { renderOps } from './render-ops';
import { renderCallsToTypeScript } from './render-typescript';

export class TypeScriptRenderablePostgresMigration
  extends PostgresMigration
  implements MigrationPlanWithAuthoringSurface
{
  readonly #calls: readonly OpFactoryCall[];
  readonly #meta: MigrationMeta;
  readonly #spaceId: string;
  readonly #snapshotsImportPath: string;
  readonly #lowerer: ExecuteRequestLowerer | undefined;
  #operationsCache:
    | readonly (
        | SqlMigrationPlanOperation<PostgresPlanTargetDetails>
        | Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>>
      )[]
    | undefined;

  constructor(
    calls: readonly OpFactoryCall[],
    meta: MigrationMeta,
    spaceId: string,
    snapshotsImportPath: string,
    lowerer?: ExecuteRequestLowerer,
  ) {
    super();
    this.#calls = calls;
    this.#meta = meta;
    this.#spaceId = spaceId;
    this.#snapshotsImportPath = snapshotsImportPath;
    this.#lowerer = lowerer;
  }

  override get operations(): readonly (
    | SqlMigrationPlanOperation<PostgresPlanTargetDetails>
    | Promise<SqlMigrationPlanOperation<PostgresPlanTargetDetails>>
  )[] {
    this.#operationsCache ??= renderOps(this.#calls, this.#lowerer);
    return this.#operationsCache;
  }

  override describe(): MigrationMeta {
    return this.#meta;
  }

  /**
   * Contract space this planner-produced plan applies to. Threaded
   * from the planner options so the runner keys the marker row by
   * the right space when executing the plan.
   */
  get spaceId(): string {
    return this.#spaceId;
  }

  renderTypeScript(resolveImportSpecifier: ImportSpecifierResolver): string {
    return renderCallsToTypeScript(this.#calls, {
      from: this.#meta.from,
      to: this.#meta.to,
      snapshotsImportPath: this.#snapshotsImportPath,
      resolveImportSpecifier,
    });
  }
}
