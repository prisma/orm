import type { ContractSourceContext, PslParserOptions } from '@internal/config/config-types';
import { loadConfig, type PrismaNextConfig, requireConfigSections } from '@internal/config-loader';
import type { ControlStack } from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import type { FormatOptions } from '@internal/psl-parser/format';
import { hasPslInterpreter, type PslInterpretCapable } from '@internal/psl-parser/interpret';
import { ifDefined } from '@internal/utils/defined';
import type { LspControlStack } from './lsp-control-stack';
import {
  hasPslInputs,
  resolveSchemaInputs,
  type SchemaInputConfig,
  type SchemaInputSet,
} from './schema-inputs';

export const CONFIG_FILENAME = 'prisma.config.ts';

export interface ProjectInterpretation {
  readonly source: PslInterpretCapable;
  readonly context: ContractSourceContext;
}

export interface ConfigResolution {
  readonly inputs: SchemaInputSet;
  readonly schemaInputConfig: SchemaInputConfig;
  readonly formatter?: FormatOptions;
  readonly parserOptions?: PslParserOptions;
  readonly controlStack: LspControlStack;
  readonly interpretation?: ProjectInterpretation;
}

const emptyLspControlStack: LspControlStack = {
  scalarTypes: [],
  pslBlockDescriptors: {},
};

export async function resolveConfigInputs(
  configPath: string,
  readText: (uri: string) => string | undefined,
): Promise<ConfigResolution> {
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
  const inputs = await resolveSchemaInputs(config, readText);
  const schemaInputConfig: SchemaInputConfig =
    config.contract === undefined ? {} : { contract: config.contract };
  if (!hasPslInputs(config)) {
    return {
      inputs,
      schemaInputConfig,
      controlStack: emptyLspControlStack,
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
  const parserOptions =
    config.contract?.source.format === 'psl' ? config.contract.source.parserOptions : undefined;
  return {
    inputs,
    schemaInputConfig,
    controlStack: lspControlStackFromStack(stack),
    ...(config.formatter === undefined ? {} : { formatter: config.formatter }),
    ...(parserOptions === undefined ? {} : { parserOptions }),
    ...(interpretation === undefined ? {} : { interpretation }),
  };
}

function lspControlStackFromStack(stack: ControlStack): LspControlStack {
  return {
    scalarTypes: [...stack.scalarTypes],
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
    authoringContributions: stack.authoringContributions,
    ...(stack.controlMutationDefaults === undefined
      ? {}
      : { controlMutationDefaults: stack.controlMutationDefaults }),
    ...ifDefined('pslDiagnostics', stack.family?.pslDiagnostics),
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
      ...ifDefined('pslDiagnostics', stack.family?.pslDiagnostics),
      codecLookup: stack.codecLookup,
      dataTypeLookup: stack.dataTypeLookup,
      controlMutationDefaults: stack.controlMutationDefaults,
      resolvedInputs: [...inputs.uris()],
      capabilities: stack.capabilities,
    },
  };
}
