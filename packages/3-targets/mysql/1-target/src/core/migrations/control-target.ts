import type { Contract } from '@internal/contract/types';
import { type SqlControlTargetDescriptor, sqlTypeLookupsOf } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type {
  ControlTargetInstance,
  MigrationPlanner,
  MigrationRunner,
} from '@internal/framework-components/control';
import { SqlStorage } from '@internal/sql-contract/types';
import { relationalNodeEntityKind, relationalNodeGranularity } from '@internal/sql-schema-ir/types';
import { setFallbackTemporal } from '@internal/type-implementations/temporal';
import { blindCast } from '@internal/utils/casts';
import { Temporal as fallbackTemporal } from 'temporal-polyfill/full/implementation';
import { mysqlTargetDescriptorMeta } from '../descriptor-meta';
import { mysqlError } from '../errors';
import { MysqlContractSerializer } from '../mysql-contract-serializer';
import { diffMysqlSchema, mysqlContractToSchema } from './diff-database-schema';
import { MysqlSchemaVerifier } from './mysql-schema-verifier';
import { MYSQL_MIGRATION_MODULE } from './op-factory-call';
import { createMysqlMigrationPlanner } from './planner';
import type { MysqlPlanTargetDetails } from './planner-target-details';
import { createMysqlMigrationRunner } from './runner';

function isSqlContract(contract: Contract | null): contract is Contract<SqlStorage> | null {
  return contract === null || contract.storage instanceof SqlStorage;
}

type MysqlControlTargetParts =
  | 'contractSerializer'
  | 'schemaVerifier'
  | 'diffSchema'
  | 'classifySubjectGranularity'
  | 'classifyEntityKind'
  | 'migrations'
  | 'create'
  | 'createPlanner'
  | 'createRunner';

/** What a target that extends MySQL gives the control target factory: its descriptor meta, which carries its target id and session settings, and the facade module its `migration.ts` files import from. */
export interface MysqlControlTargetOptions<TargetId extends string> {
  readonly descriptorMeta: Omit<
    SqlControlTargetDescriptor<TargetId, MysqlPlanTargetDetails>,
    MysqlControlTargetParts
  >;
  readonly migrationModule: string;
}

/** The control target of MySQL, or of a target that extends it, which reuses MySQL's planner, runner, schema verifier and contract serializer under its own target id. */
export function createMysqlControlTargetDescriptor<TargetId extends string = 'mysql'>(
  options: MysqlControlTargetOptions<TargetId>,
): SqlControlTargetDescriptor<TargetId, MysqlPlanTargetDetails> {
  setFallbackTemporal(fallbackTemporal);
  const { descriptorMeta } = options;
  const migrationTarget = {
    targetId: descriptorMeta.targetId,
    migrationModule: options.migrationModule,
  };
  return {
    ...descriptorMeta,
    contractSerializer: new MysqlContractSerializer(),
    schemaVerifier: new MysqlSchemaVerifier(),
    diffSchema: diffMysqlSchema,
    classifySubjectGranularity: relationalNodeGranularity,
    classifyEntityKind: relationalNodeEntityKind,
    migrations: {
      createPlanner(adapter: SqlControlAdapter<TargetId>): MigrationPlanner<'sql', TargetId> {
        return createMysqlMigrationPlanner(adapter, migrationTarget);
      },
      createRunner(family) {
        return blindCast<
          MigrationRunner<'sql', TargetId>,
          'the SQL runner takes SQL per-space options; the framework types them as the generic MigrationRunnerPerSpaceOptions'
        >(createMysqlMigrationRunner(family));
      },
      contractToSchema(contract, frameworkComponents) {
        if (!isSqlContract(contract)) {
          throw mysqlError(
            'CONTRACT.TARGET_MISMATCH',
            'The MySQL target received a contract that is not a SQL contract.',
          );
        }
        return mysqlContractToSchema(contract, sqlTypeLookupsOf(frameworkComponents));
      },
    },
    create(): ControlTargetInstance<'sql', TargetId> {
      return { familyId: 'sql', targetId: descriptorMeta.targetId };
    },
    createPlanner(adapter: SqlControlAdapter<TargetId>) {
      return createMysqlMigrationPlanner(adapter, migrationTarget);
    },
    createRunner(family) {
      return createMysqlMigrationRunner(family);
    },
  };
}

const mysqlControlTargetDescriptor = createMysqlControlTargetDescriptor({
  descriptorMeta: mysqlTargetDescriptorMeta,
  migrationModule: MYSQL_MIGRATION_MODULE,
});

export default mysqlControlTargetDescriptor;
