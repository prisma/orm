import type { ContractSourceContext } from '@internal/config/config-types';
import { loadConfig, type PrismaNextConfig, requireConfigSections } from '@internal/config-loader';
import type { ControlStack } from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import type { FormatOptions } from '@internal/psl-parser/format';
import { hasPslInterpreter, type PslInterpretCapable } from '@internal/psl-parser/interpret';
import type { PipelineInputs } from './pipeline';
import { hasPslInputs, resolveSchemaInputs, type SchemaInputSet } from './schema-inputs';

export const CONFIG_FILENAME = 'prisma.config.ts';

export interface ProjectInterpretation {
  readonly source: PslInterpretCapable;
  readonly context: ContractSourceContext;
}

export interface ConfigResolution {
  readonly inputs: SchemaInputSet;
  readonly formatter?: FormatOptions;
  readonly controlStack: PipelineInputs;
  readonly interpretation?: ProjectInterpretation;
}

const emptyPipelineInputs: PipelineInputs = {
  scalarTypes: [],
  pslBlockDescriptors: {},
};

export async function resolveConfigInputs(configPath: string): Promise<ConfigResolution> {
  // The language server keeps its established failure channel: a config that
  // cannot serve the project is thrown and published as a document diagnostic.
  const loaded = await loadConfig(configPath);
  if (!loaded.ok) {
    throw loaded.failure;
  }
  const projectSections = requireConfigSections(loaded.value, ['contract', 'formatter']);
  if (!projectSections.ok) {
    throw projectSections.failure;
  }
  const config = projectSections.value;
  const inputs = resolveSchemaInputs(config);
  if (!hasPslInputs(config)) {
    return {
      inputs,
      controlStack: emptyPipelineInputs,
      ...(config.formatter === undefined ? {} : { formatter: config.formatter }),
    };
  }
  // Only a PSL project builds a control stack, so only it is blocked by the
  // sections that stack is assembled from.
  const controlSections = requireConfigSections(loaded.value, [
    'family',
    'target',
    'adapter',
    'driver',
    'extensions',
  ]);
  if (!controlSections.ok) {
    throw controlSections.failure;
  }
  const stack = createControlStack(config);
  const interpretation = resolveInterpretation(config, stack, inputs);
  return {
    inputs,
    controlStack: pipelineInputsFromStack(stack),
    ...(config.formatter === undefined ? {} : { formatter: config.formatter }),
    ...(interpretation === undefined ? {} : { interpretation }),
  };
}

function pipelineInputsFromStack(stack: ControlStack): PipelineInputs {
  return {
    scalarTypes: [...stack.scalarTypes],
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
    authoringContributions: stack.authoringContributions,
    ...(stack.controlMutationDefaults === undefined
      ? {}
      : { controlMutationDefaults: stack.controlMutationDefaults }),
  };
}

function resolveInterpretation(
  config: PrismaNextConfig,
  stack: ControlStack,
  inputs: SchemaInputSet,
): ProjectInterpretation | undefined {
  const source = config.contract?.source;
  if (source === undefined || !hasPslInterpreter(source)) {
    return undefined;
  }
  return {
    source,
    context: {
      composedExtensions: stack.extensions.map((p) => p.id),
      composedExtensionContracts: stack.extensionContracts,
      authoringContributions: stack.authoringContributions,
      codecLookup: stack.codecLookup,
      controlMutationDefaults: stack.controlMutationDefaults,
      resolvedInputs: [...inputs.uris()],
      capabilities: stack.capabilities,
    },
  };
}
