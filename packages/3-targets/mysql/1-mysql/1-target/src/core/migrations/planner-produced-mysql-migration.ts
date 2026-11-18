import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type {
  MigrationPlanWithAuthoringSurface,
  OpFactoryCall,
} from '@internal/framework-components/control';
import type { ImportSpecifierResolver } from '@internal/framework-components/emission';
import type { MigrationMeta } from '@internal/migration-tools/migration';
import { MysqlMigrationBase } from './mysql-migration';
import type { Op } from './operations';
import { renderOps } from './render-ops';
import { renderCallsToTypeScript } from './render-typescript';

/** The target a planner plans for: the id its operations and migrations carry, and the facade module its `migration.ts` imports from. */
export interface MysqlMigrationTarget<TargetId extends string> {
  readonly targetId: TargetId;
  readonly migrationModule: string;
}

export interface MysqlMigrationDestinationInfo {
  readonly storageHash: string;
  readonly profileHash?: string;
}

/** The plan the MySQL planner produces: its operations, and the `migration.ts` that writes them. */
export class TypeScriptRenderableMysqlMigration<TargetId extends string = 'mysql'>
  extends MysqlMigrationBase<TargetId>
  implements MigrationPlanWithAuthoringSurface
{
  readonly targetId: TargetId;
  readonly #migrationModule: string;
  readonly #calls: readonly OpFactoryCall[];
  readonly #meta: MigrationMeta;
  readonly #destination: MysqlMigrationDestinationInfo;
  readonly #spaceId: string;
  readonly #snapshotsImportPath: string;
  readonly #lowerer: ExecuteRequestLowerer | undefined;
  #operationsCache: readonly (Op | Promise<Op>)[] | undefined;

  constructor(options: {
    readonly calls: readonly OpFactoryCall[];
    readonly meta: MigrationMeta;
    readonly spaceId: string;
    readonly snapshotsImportPath: string;
    readonly destination?: MysqlMigrationDestinationInfo;
    readonly lowerer?: ExecuteRequestLowerer;
    readonly target: MysqlMigrationTarget<TargetId>;
  }) {
    super();
    this.targetId = options.target.targetId;
    this.#migrationModule = options.target.migrationModule;
    this.#calls = options.calls;
    this.#meta = options.meta;
    this.#spaceId = options.spaceId;
    this.#snapshotsImportPath = options.snapshotsImportPath;
    this.#destination = options.destination ?? { storageHash: options.meta.to };
    this.#lowerer = options.lowerer;
  }

  override get operations(): readonly (Op | Promise<Op>)[] {
    this.#operationsCache ??= renderOps(this.#calls, this.#lowerer, this.targetId);
    return this.#operationsCache;
  }

  override describe(): MigrationMeta {
    return this.#meta;
  }

  override get destination(): MysqlMigrationDestinationInfo {
    return this.#destination;
  }

  get spaceId(): string {
    return this.#spaceId;
  }

  renderTypeScript(resolveImportSpecifier: ImportSpecifierResolver): string {
    return renderCallsToTypeScript(this.#calls, {
      from: this.#meta.from,
      to: this.#meta.to,
      snapshotsImportPath: this.#snapshotsImportPath,
      resolveImportSpecifier,
      migrationModule: this.#migrationModule,
    });
  }
}
