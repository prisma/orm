import type { SqlControlTargetDescriptor } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type {
  ControlTargetInstance,
  MigrationRunner,
} from '@internal/framework-components/control';
import { setFallbackTemporal } from '@internal/type-implementations/temporal';
import { blindCast } from '@internal/utils/casts';
import { Temporal as fallbackTemporal } from 'temporal-polyfill/full/implementation';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';
import { diffPostgresSchema } from '../core/migrations/diff-database-schema';
import { createPostgresMigrationPlanner } from '../core/migrations/planner';
import type { PostgresPlanTargetDetails } from '../core/migrations/planner-target-details';
import { postgresContractToSchema } from '../core/migrations/postgres-contract-to-schema';
import { PostgresSchemaVerifier } from '../core/migrations/postgres-schema-verifier';
import { createPostgresMigrationRunner } from '../core/migrations/runner';
import { PostgresContractSerializer } from '../core/postgres-contract-serializer';
import { inferPostgresPslContract } from '../core/psl-infer/infer-psl-contract';
import { buildPostgresPslContract } from '../core/psl-print/psl-contract';
import { PostgresDatabaseSchemaNode } from '../core/schema-ir/postgres-database-schema-node';
import {
  postgresDiffSubjectEntityKind,
  postgresDiffSubjectGranularity,
} from '../core/schema-ir/schema-node-kinds';

function createPostgresTargetDescriptor(): SqlControlTargetDescriptor<
  'postgres',
  PostgresPlanTargetDetails
> {
  setFallbackTemporal(fallbackTemporal);
  return {
    ...postgresTargetDescriptorMeta,
    contractSerializer: new PostgresContractSerializer(),
    schemaVerifier: new PostgresSchemaVerifier(),
    inferPslContract(schema, context, describedContracts) {
      PostgresDatabaseSchemaNode.assert(schema);
      return inferPostgresPslContract(schema, context, describedContracts);
    },
    buildPslContract(contract, context) {
      return buildPostgresPslContract(contract, context);
    },
    diffSchema(input) {
      return diffPostgresSchema(input);
    },
    classifySubjectGranularity: postgresDiffSubjectGranularity,
    classifyEntityKind: postgresDiffSubjectEntityKind,
    migrations: {
      createPlanner(adapter: SqlControlAdapter<'postgres'>) {
        return createPostgresMigrationPlanner(adapter);
      },
      createRunner(family) {
        return blindCast<
          MigrationRunner<'sql', 'postgres'>,
          'Postgres migration runner implements the framework migration runner surface for sql/postgres'
        >(createPostgresMigrationRunner(family));
      },
      contractToSchema(contract, frameworkComponents) {
        return postgresContractToSchema(contract, frameworkComponents);
      },
    },
    create(): ControlTargetInstance<'sql', 'postgres'> {
      return {
        familyId: 'sql',
        targetId: 'postgres',
      };
    },
    /**
     * Direct method for SQL-specific usage.
     * @deprecated Use migrations.createPlanner() for CLI compatibility.
     */
    createPlanner(adapter: SqlControlAdapter<'postgres'>) {
      return createPostgresMigrationPlanner(adapter);
    },
    /**
     * Direct method for SQL-specific usage.
     * @deprecated Use migrations.createRunner() for CLI compatibility.
     */
    createRunner(family) {
      return createPostgresMigrationRunner(family);
    },
  };
}

const postgresTargetDescriptor = createPostgresTargetDescriptor();

export { postgresNowGeneratorControlDescriptors } from '../core/date-time-now-generators';
export { decodePostgresListText, parsePostgresListText } from '../core/list-decoder';
export {
  postgresNativeAuthoringTypes,
  postgresScalarAndNativeTypeConstructors,
  postgresScalarAuthoringTypes,
} from '../core/type-constructors';

export default postgresTargetDescriptor;
