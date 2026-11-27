import type {
  ContractConfig,
  ContractSourceContext,
  ContractSourceDiagnostic,
  ContractSourceProvider,
} from '@internal/config/config-types';
import { mergeCapabilityMatrices } from '@internal/framework-components/components';
import { hasPslInterpreter, type PslInterpretCapable } from '@internal/psl-parser/interpret';
import { isSourceGivenNoCapabilities } from '@internal/sql-contract-psl/provider';
import { capabilitiesFromKeys } from '@internal/sql-contract-ts/contract-builder';
import { type ImportRequirement, renderImports, TsExpression } from '@internal/ts-render';
import {
  defaultRequiredCapabilities,
  hasDefaultRequiredCapabilities,
} from '../contract/contract-capabilities';
import { RequiredCapabilitiesList } from '../contract/required-capabilities-list';
import { contractBuilderModule } from './components';
import { configModule } from './module-base';

/** What the author writes to list the capabilities a contract left out, rendered as `init` writes it, and where. */
export interface RequiredCapabilitiesPlace {
  /** The property the author writes: `requiredCapabilities`, `contract` or `capabilities`. */
  readonly key: string;
  readonly value: TsExpression;
  /** Where the property goes, such as `in defineContract`. */
  readonly where: string;
  /** The contract source's path, which the warning is reported at. */
  readonly path: string;
}

/** The place in `defineContract`, for a TypeScript contract. */
export function inDefineContract(path: string): RequiredCapabilitiesPlace {
  return {
    key: 'requiredCapabilities',
    value: new RequiredCapabilitiesList(contractBuilderModule),
    where: 'in defineContract',
    path,
  };
}

/** The place in the config, where `entry` replaces the contract entry. */
export function asTheContractEntry(entry: TsExpression, path: string): RequiredCapabilitiesPlace {
  return { key: 'contract', value: entry, where: 'as the contract entry in the config', path };
}

class ContractCapabilitiesCall extends TsExpression {
  readonly #required = new RequiredCapabilitiesList(configModule);

  renderTypeScript(): string {
    return `postgresContractCapabilities(${this.#required.renderTypeScript()})`;
  }

  importRequirements(): readonly ImportRequirement[] {
    return [
      { moduleSpecifier: configModule, symbol: 'postgresContractCapabilities' },
      ...this.#required.importRequirements(),
    ];
  }
}

/** The warning the commands that load the contract source report for a contract that lists no required capabilities: what to write and its import. */
export function requiredCapabilitiesNotListed(
  place: RequiredCapabilitiesPlace,
  sourceId: string,
): ContractSourceDiagnostic {
  const line = `${place.key}: ${place.value.renderTypeScript()}`;
  const imports = renderImports(place.value.importRequirements()).trim();
  return {
    code: 'CONTRACT.REQUIRED_CAPABILITIES_NOT_LISTED',
    message: `Your contract does not list the capabilities it requires, so it requires those of the newest PostgreSQL version and of the driver. Prisma 8.0 removes this default and requires the list. Write this ${place.where}, with its import:\n\n${line}\n\n${imports}`,
    sourceId,
    severity: 'warning',
    data: { line, imports },
  };
}

function reportNotListed(context: ContractSourceContext, place: RequiredCapabilitiesPlace): void {
  context.reportWarning?.(
    requiredCapabilitiesNotListed(place, context.resolvedInputs[0] ?? place.path),
  );
}

/** `config` whose source reports `requiredCapabilitiesNotListed` each time it loads a contract that `defaulted` says was built with the default list. */
export function warnWhenRequiredCapabilitiesDefaulted(
  config: ContractConfig,
  place: RequiredCapabilitiesPlace,
  defaulted: (loaded: unknown) => boolean,
): ContractConfig {
  const { source } = config;
  return {
    ...config,
    source: {
      ...source,
      load: async (context) => {
        const result = await source.load(context);
        if (result.ok && defaulted(result.value)) reportNotListed(context, place);
        return result;
      },
    },
  };
}

const defaultCapabilities = capabilitiesFromKeys(defaultRequiredCapabilities);

function withDefaultCapabilities(context: ContractSourceContext): ContractSourceContext {
  return {
    ...context,
    capabilities: mergeCapabilityMatrices(context.capabilities, [
      { capabilities: defaultCapabilities },
    ]),
  };
}

const inTheSourceOptions: Omit<RequiredCapabilitiesPlace, 'path'> = {
  key: 'capabilities',
  value: new ContractCapabilitiesCall(),
  where: 'in the options of the contract source given to defineConfig',
};

function sourceWithDefaultCapabilities(
  source: ContractSourceProvider,
  place: RequiredCapabilitiesPlace,
): ContractSourceProvider {
  const load: ContractSourceProvider['load'] = async (context) => {
    const result = await source.load(withDefaultCapabilities(context));
    if (result.ok) reportNotListed(context, place);
    return result;
  };
  if (!hasPslInterpreter(source)) return { ...source, load };
  const interpreting: PslInterpretCapable = {
    ...source,
    load,
    interpret: (input, context) => source.interpret(input, withDefaultCapabilities(context)),
  };
  return interpreting;
}

/**
 * A ready `ContractConfig`, such as `prismaContract(...)` or `typescriptContract(contract)`, given the default required capabilities and the warning when its source lists none. Prisma 8.0 removes this default and requires the list.
 *
 * A Prisma schema source built with no `capabilities` option loads, and is interpreted in the editor, with the default added to the capabilities it sees; one given `capabilities`, even `{}`, is left as written. A TypeScript contract built by `defineContract` without a list already has the default.
 */
export function defaultRequiredCapabilitiesOfReadySource(config: ContractConfig): ContractConfig {
  const { source } = config;
  const path = source.inputs?.[0];
  if (isSourceGivenNoCapabilities(source)) {
    return {
      ...config,
      source: sourceWithDefaultCapabilities(source, {
        ...inTheSourceOptions,
        path: path ?? 'config',
      }),
    };
  }
  return warnWhenRequiredCapabilitiesDefaulted(
    config,
    inDefineContract(path ?? 'typescriptContract'),
    hasDefaultRequiredCapabilities,
  );
}
