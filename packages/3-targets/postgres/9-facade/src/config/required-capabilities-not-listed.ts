import type {
  ContractConfig,
  ContractSourceContext,
  ContractSourceDiagnostic,
} from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import { mergeCapabilityMatrices } from '@internal/framework-components/components';
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

function requiresOnly(
  contract: Contract,
  declared: ContractSourceContext['capabilities'],
): boolean {
  return Object.entries(contract.capabilities).every(([namespace, flags]) =>
    Object.entries(flags).every(
      ([flag, required]) => !required || declared[namespace]?.[flag] === true,
    ),
  );
}

const defaultCapabilities = capabilitiesFromKeys(defaultRequiredCapabilities);

/**
 * A ready `ContractConfig`, such as `prismaContract(...)` or `typescriptContract(contract)`, given the default required capabilities and the warning when its source lists none.
 *
 * A Prisma schema source given no `capabilities` takes the context's, which the PostgreSQL components leave empty, so its contract requires nothing they do not declare; it is loaded again with the default added to the context. A TypeScript contract built by `defineContract` without a list already has the default.
 */
export function defaultRequiredCapabilitiesOfReadySource(config: ContractConfig): ContractConfig {
  const { source } = config;
  const path = source.inputs?.[0] ?? 'config';
  return {
    ...config,
    source: {
      ...source,
      load: async (context) => {
        const held: ContractSourceDiagnostic[] = [];
        const first = await source.load({ ...context, reportWarning: (d) => held.push(d) });
        if (
          first.ok &&
          source.format === 'psl' &&
          requiresOnly(first.value, context.capabilities)
        ) {
          const result = await source.load({
            ...context,
            capabilities: mergeCapabilityMatrices(context.capabilities, [
              { capabilities: defaultCapabilities },
            ]),
          });
          if (result.ok) {
            reportNotListed(context, {
              key: 'capabilities',
              value: new ContractCapabilitiesCall(),
              where: 'in the options of the contract source given to defineConfig',
              path,
            });
          }
          return result;
        }
        for (const warning of held) context.reportWarning?.(warning);
        if (first.ok && hasDefaultRequiredCapabilities(first.value)) {
          reportNotListed(context, inDefineContract(path));
        }
        return first;
      },
    },
  };
}
