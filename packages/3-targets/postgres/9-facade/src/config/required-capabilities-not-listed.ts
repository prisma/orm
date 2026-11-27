import type { ContractConfig, ContractSourceDiagnostic } from '@internal/config/config-types';
import { renderImports } from '@internal/ts-render';
import { RequiredCapabilitiesList } from '../contract/required-capabilities-list';

/** Where the author writes the list that a contract left out, and the module its lists are imported from there. */
export interface RequiredCapabilitiesPlace {
  /** As the refusals name it: `in defineContract`, or `beside the contract path '…' in the config`. */
  readonly where: string;
  readonly module: string;
  /** The contract source's path, which the warning is reported at. */
  readonly path: string;
}

/** The warning `prisma contract emit` reports for a contract that lists no required capabilities: the line to add and its import, rendered as `init` writes them. */
export function requiredCapabilitiesNotListed(
  place: RequiredCapabilitiesPlace,
  sourceId: string,
): ContractSourceDiagnostic {
  const list = new RequiredCapabilitiesList(place.module);
  const line = `requiredCapabilities: ${list.renderTypeScript()}`;
  const imports = renderImports(list.importRequirements()).trim();
  return {
    code: 'CONTRACT.REQUIRED_CAPABILITIES_NOT_LISTED',
    message: `Your contract does not list the capabilities it requires, so it requires those of the newest PostgreSQL version and of the driver. Add \`${line}\` ${place.where}, with \`${imports}\`. Prisma 8.0 removes this default and requires the list.`,
    sourceId,
    severity: 'warning',
    data: { line, imports },
  };
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
        if (result.ok && defaulted(result.value)) {
          context.reportWarning?.(
            requiredCapabilitiesNotListed(place, context.resolvedInputs[0] ?? place.path),
          );
        }
        return result;
      },
    },
  };
}
