import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type {
  MigrationPlanWithAuthoringSurface,
  OpFactoryCall,
} from '@internal/framework-components/control';
import type { ImportSpecifierResolver } from '@internal/framework-components/emission';
import type { MigrationMeta } from '@internal/migration-tools/migration';
import type { SqlitePlanTargetDetails } from './planner-target-details';
import { renderOps } from './render-ops';
import { renderCallsToTypeScript } from './render-typescript';
import { SqliteMigration } from './sqlite-migration';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

export interface SqliteMigrationDestinationInfo {
  readonly storageHash: string;
  readonly profileHash?: string;
}

export class TypeScriptRenderableSqliteMigration
  extends SqliteMigration
  implements MigrationPlanWithAuthoringSurface
{
  readonly #calls: readonly OpFactoryCall[];
  readonly #meta: MigrationMeta;
  readonly #destination: SqliteMigrationDestinationInfo;
  readonly #spaceId: string;
  readonly #snapshotsImportPath: string;
  readonly #lowerer: ExecuteRequestLowerer | undefined;
  #operationsCache: readonly (Op | Promise<Op>)[] | undefined;

  constructor(
    calls: readonly OpFactoryCall[],
    meta: MigrationMeta,
    spaceId: string,
    snapshotsImportPath: string,
    destination?: SqliteMigrationDestinationInfo,
    lowerer?: ExecuteRequestLowerer,
  ) {
    super();
    this.#calls = calls;
    this.#meta = meta;
    this.#spaceId = spaceId;
    this.#snapshotsImportPath = snapshotsImportPath;
    this.#destination = destination ?? { storageHash: meta.to };
    this.#lowerer = lowerer;
  }

  override get operations(): readonly (Op | Promise<Op>)[] {
    this.#operationsCache ??= renderOps(this.#calls, this.#lowerer);
    return this.#operationsCache;
  }

  override describe(): MigrationMeta {
    return this.#meta;
  }

  override get destination(): SqliteMigrationDestinationInfo {
    return this.#destination;
  }

  /**
   * Contract space this planner-produced plan applies to. Threaded
   * from {@link SqlMigrationPlannerPlanOptions.spaceId} so the runner
   * keys the marker row by the right space when executing the plan.
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
