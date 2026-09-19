import type { SqlControlTargetDescriptor } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type {
  ControlTargetInstance,
  MigrationRunner,
} from '@internal/framework-components/control';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';
import { diffPostgresSchema } from '../core/migrations/diff-database-schema';
import { createPostgresMigrationPlanner } from '../core/migrations/planner';
import type { PostgresPlanTargetDetails } from '../core/migrations/planner-target-details';
import { postgresContractToSchema } from '../core/migrations/postgres-contract-to-schema';
import { createPostgresMigrationRunner } from '../core/migrations/runner';
import { PostgresContractSerializer } from '../core/postgres-contract-serializer';
import { PostgresSchemaVerifier } from '../core/postgres-schema-verifier';
import { inferPostgresPslContract } from '../core/psl-infer/infer-psl-contract';
import { PostgresDatabaseSchemaNode } from '../core/schema-ir/postgres-database-schema-node';
import {
  postgresDiffSubjectEntityKind,
  postgresDiffSubjectGranularity,
} from '../core/schema-ir/schema-node-kinds';

export { postgresRenderDefault } from '../core/migrations/postgres-contract-to-schema';

const postgresTargetDescriptor: SqlControlTargetDescriptor<'postgres', PostgresPlanTargetDetails> =
  {
    ...postgresTargetDescriptorMeta,
    contractSerializer: new PostgresContractSerializer(),
    schemaVerifier: new PostgresSchemaVerifier(),
    inferPslContract(schema, describedContracts) {
      PostgresDatabaseSchemaNode.assert(schema);
      return inferPostgresPslContract(schema, describedContracts);
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

export {
  INSTANT_NOW_GENERATOR_ID,
  instantNowControlDescriptor,
} from '../core/instant-now-generator';
export { decodePostgresListText, parsePostgresListText } from '../core/list-decoder';
export {
  PLAIN_DATE_TIME_NOW_GENERATOR_ID,
  plainDateTimeNowControlDescriptor,
} from '../core/plain-date-time-now-generator';

export default postgresTargetDescriptor;
