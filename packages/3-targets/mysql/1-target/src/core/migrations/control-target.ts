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
import { createMysqlMigrationPlanner } from './planner';
import type { MysqlPlanTargetDetails } from './planner-target-details';
import { createMysqlMigrationRunner } from './runner';

function isSqlContract(contract: Contract | null): contract is Contract<SqlStorage> | null {
  return contract === null || contract.storage instanceof SqlStorage;
}

function createMysqlControlTargetDescriptor(): SqlControlTargetDescriptor<
  'mysql',
  MysqlPlanTargetDetails
> {
  setFallbackTemporal(fallbackTemporal);
  return {
    ...mysqlTargetDescriptorMeta,
    contractSerializer: new MysqlContractSerializer(),
    schemaVerifier: new MysqlSchemaVerifier(),
    diffSchema: diffMysqlSchema,
    classifySubjectGranularity: relationalNodeGranularity,
    classifyEntityKind: relationalNodeEntityKind,
    migrations: {
      createPlanner(adapter: SqlControlAdapter<'mysql'>): MigrationPlanner<'sql', 'mysql'> {
        return createMysqlMigrationPlanner(adapter);
      },
      createRunner(family) {
        return blindCast<
          MigrationRunner<'sql', 'mysql'>,
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
    create(): ControlTargetInstance<'sql', 'mysql'> {
      return { familyId: 'sql', targetId: 'mysql' };
    },
    createPlanner(adapter: SqlControlAdapter<'mysql'>) {
      return createMysqlMigrationPlanner(adapter);
    },
    createRunner(family) {
      return createMysqlMigrationRunner(family);
    },
  };
}

const mysqlControlTargetDescriptor = createMysqlControlTargetDescriptor();

export default mysqlControlTargetDescriptor;
