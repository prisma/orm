import type { ColumnDefault } from '@internal/contract/types';
import type { SqlControlTargetDescriptor } from '@internal/family-sql/control';
import { buildDataTypeResolver } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import type {
  ControlTargetInstance,
  MigrationRunner,
} from '@internal/framework-components/control';
import type { StorageColumn } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { Temporal as fallbackTemporal } from 'temporal-polyfill/full/implementation';
import { postgresResolveDefault } from '../core/default-normalizer';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';
import { contractToPostgresDatabaseSchemaNode } from '../core/migrations/contract-to-postgres-database-schema-node';
import { diffPostgresSchema } from '../core/migrations/diff-database-schema';
import { buildPostgresNativeTypeExpander } from '../core/migrations/native-type-expander';
import { createPostgresMigrationPlanner } from '../core/migrations/planner';
import { renderDefaultLiteral } from '../core/migrations/planner-ddl-builders';
import type { PostgresPlanTargetDetails } from '../core/migrations/planner-target-details';
import { createPostgresMigrationRunner } from '../core/migrations/runner';
import { PostgresContractSerializer } from '../core/postgres-contract-serializer';
import type { PostgresContract } from '../core/postgres-schema';
import { PostgresSchemaVerifier } from '../core/postgres-schema-verifier';
import { inferPostgresPslContract } from '../core/psl-infer/infer-psl-contract';
import { buildPostgresPslContract } from '../core/psl-print/psl-contract';
import { setFallbackTemporal } from '../core/require-temporal';
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
        const expander = buildPostgresNativeTypeExpander(frameworkComponents);
        const postgresContract = blindCast<
          PostgresContract | null,
          'the family resolver only binds this hook for a Postgres-target contract'
        >(contract);
        return contractToPostgresDatabaseSchemaNode(postgresContract, {
          annotationNamespace: 'pg',
          expandNativeType: expander,
          renderDefault: postgresRenderDefault,
          resolveDefault: postgresResolveDefault,
          ...ifDefined('dataTypeOf', buildDataTypeResolver(frameworkComponents)),
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
}

const postgresTargetDescriptor = createPostgresTargetDescriptor();

export {
  INSTANT_NOW_GENERATOR_ID,
  instantNowControlDescriptor,
} from '../core/instant-now-generator';
export { decodePostgresListText, parsePostgresListText } from '../core/list-decoder';
export {
  PLAIN_DATE_TIME_NOW_GENERATOR_ID,
  plainDateTimeNowControlDescriptor,
} from '../core/plain-date-time-now-generator';
export {
  postgresNativeAuthoringTypes,
  postgresScalarAuthoringTypes,
} from '../core/type-constructors';

export default postgresTargetDescriptor;
