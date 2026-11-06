import {
  assembleGeneratorFunctions,
  type GeneratorFunctionContribution,
  type GeneratorFunctionRegistry,
  type MutationDefaultGeneratorDescriptor,
} from '@internal/framework-components/components';
import {
  sqlFamilyGeneratorDescriptors,
  sqlFamilyGeneratorFunctions,
} from '../../../9-family/src/core/generator-functions';

const postgresGeneratorFunctionsUrl = new URL(
  '../../../../3-targets/postgres/1-target/src/core/generator-functions.ts',
  import.meta.url,
).href;

const postgres: {
  readonly postgresGeneratorFunctions: readonly GeneratorFunctionContribution[];
  readonly postgresGeneratorDescriptors: readonly MutationDefaultGeneratorDescriptor[];
} = await import(postgresGeneratorFunctionsUrl);

/** The SQL family's generator functions with the real Postgres bindings, as a Postgres stack assembles them. */
export const fixtureGeneratorFunctions: GeneratorFunctionRegistry = assembleGeneratorFunctions([
  {
    id: 'sql',
    generatorFunctions: sqlFamilyGeneratorFunctions,
    controlMutationDefaults: { generatorDescriptors: sqlFamilyGeneratorDescriptors },
  },
  {
    id: 'postgres',
    generatorFunctions: postgres.postgresGeneratorFunctions,
    controlMutationDefaults: { generatorDescriptors: postgres.postgresGeneratorDescriptors },
  },
]);
