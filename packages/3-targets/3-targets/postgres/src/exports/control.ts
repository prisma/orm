import type { ColumnDefault } from '@internal/contract/types';
import type { SqlControlTargetDescriptor } from '@internal/family-sql/control';
import { buildNativeTypeExpander } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type {
  ControlTargetInstance,
  MigrationRunner,
} from '@internal/framework-components/control';
import type { StorageColumn } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { postgresResolveDefault } from '../core/default-normalizer';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';
import { contractToPostgresDatabaseSchemaNode } from '../core/migrations/contract-to-postgres-database-schema-node';
import { diffPostgresSchema } from '../core/migrations/diff-database-schema';
import { createPostgresMigrationPlanner } from '../core/migrations/planner';
import { renderDefaultLiteral } from '../core/migrations/planner-ddl-builders';
import type { PostgresPlanTargetDetails } from '../core/migrations/planner-target-details';
import { createPostgresMigrationRunner } from '../core/migrations/runner';
import { PostgresContractSerializer } from '../core/postgres-contract-serializer';
import type { PostgresContract } from '../core/postgres-schema';
import { PostgresSchemaVerifier } from '../core/postgres-schema-verifier';
import { inferPostgresPslContract } from '../core/psl-infer/infer-psl-contract';
import { PostgresDatabaseSchemaNode } from '../core/schema-ir/postgres-database-schema-node';
import {
  postgresDiffSubjectEntityKind,
  postgresDiffSubjectGranularity,
} from '../core/schema-ir/schema-node-kinds';

export function postgresRenderDefault(def: ColumnDefault, column: StorageColumn): string {
  if (def.kind === 'function') {
    return def.expression;
  }
  return renderDefaultLiteral(def.value, column);
}

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
        return createPostgresMigrationRunner(family) as MigrationRunner<'sql', 'postgres'>;
      },
      contractToSchema(contract, frameworkComponents) {
        const expander = buildNativeTypeExpander(frameworkComponents);
        const postgresContract = blindCast<
          PostgresContract | null,
          'the family resolver only binds this hook for a Postgres-target contract'
        >(contract);
        return contractToPostgresDatabaseSchemaNode(postgresContract, {
          annotationNamespace: 'pg',
          ...ifDefined('expandNativeType', expander),
          renderDefault: postgresRenderDefault,
          resolveDefault: postgresResolveDefault,
        });
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

export default postgresTargetDescriptor;
