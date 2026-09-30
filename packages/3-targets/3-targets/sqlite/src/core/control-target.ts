import type { Contract } from '@internal/contract/types';
import type { SqlControlTargetDescriptor } from '@internal/family-sql/control';
import { buildDataTypeResolver } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type {
  ControlTargetInstance,
  MigrationPlanner,
  MigrationRunner,
} from '@internal/framework-components/control';
import { SqlStorage } from '@internal/sql-contract/types';
import { relationalNodeEntityKind, relationalNodeGranularity } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { sqliteTargetDescriptorMeta } from './descriptor-meta';
import { sqliteError } from './errors';
import { diffSqliteSchema, sqliteContractToSchema } from './migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from './migrations/planner';
import type { SqlitePlanTargetDetails } from './migrations/planner-target-details';
import { createSqliteMigrationRunner } from './migrations/runner';
import { SqliteContractSerializer } from './sqlite-contract-serializer';
import { SqliteSchemaVerifier } from './sqlite-schema-verifier';

function isSqlContract(contract: Contract | null): contract is Contract<SqlStorage> | null {
  return contract === null || contract.storage instanceof SqlStorage;
}

const sqliteControlTargetDescriptor: SqlControlTargetDescriptor<'sqlite', SqlitePlanTargetDetails> =
  {
    ...sqliteTargetDescriptorMeta,
    contractSerializer: new SqliteContractSerializer(),
    schemaVerifier: new SqliteSchemaVerifier(),
    diffSchema(input) {
      return diffSqliteSchema(input);
    },
    classifySubjectGranularity: relationalNodeGranularity,
    classifyEntityKind: relationalNodeEntityKind,
    migrations: {
      createPlanner(adapter: SqlControlAdapter<'sqlite'>): MigrationPlanner<'sql', 'sqlite'> {
        return createSqliteMigrationPlanner(adapter);
      },
      createRunner(family) {
        return createSqliteMigrationRunner(family) as MigrationRunner<'sql', 'sqlite'>;
      },
      contractToSchema(contract, frameworkComponents) {
        // The framework SPI types `contract` as the generic
        // `Contract | null`. Any contract reaching the sqlite
        // target descriptor is SQL-family by construction (the
        // family contract resolver would have refused to bind a
        // sqlite target otherwise); the `isSqlContract` predicate
        // encodes that invariant at runtime + narrows the generic
        // to `Contract<SqlStorage>` without a blind cast.
        if (!isSqlContract(contract)) {
          throw sqliteError(
            'CONTRACT.TARGET_MISMATCH',
            'sqliteControlTargetDescriptor.contractToSchema received a non-SQL contract; expected Contract<SqlStorage>',
          );
        }
        return sqliteContractToSchema(contract, {
          ...ifDefined('dataTypeOf', buildDataTypeResolver(frameworkComponents)),
        });
      },
    },
    create(): ControlTargetInstance<'sql', 'sqlite'> {
      return {
        familyId: 'sql',
        targetId: 'sqlite',
      };
    },
    createPlanner(adapter: SqlControlAdapter<'sqlite'>) {
      return createSqliteMigrationPlanner(adapter);
    },
    createRunner(family) {
      return createSqliteMigrationRunner(family);
    },
  };

export default sqliteControlTargetDescriptor;
