import {
  type ContractSourceFormat,
  DEFAULT_CONTRACT_SOURCE_DIR,
} from '@internal/config/config-types';
import { type ImportRequirement, renderImports } from '@internal/ts-render';
import type { ConfigExpression, ContractEntryInput } from '../init-contribution';

export function defaultSchemaPath(authoring: ContractSourceFormat): string {
  if (authoring === 'typescript') {
    return `${DEFAULT_CONTRACT_SOURCE_DIR}/contract.ts`;
  }
  return `${DEFAULT_CONTRACT_SOURCE_DIR}/contract.prisma`;
}

/**
 * `renderImports` puts each module name between single quotes as it is, so a quote or a
 * backslash in the name is escaped here.
 */
function escapedForSingleQuotes(requirement: ImportRequirement): ImportRequirement {
  return {
    ...requirement,
    moduleSpecifier: requirement.moduleSpecifier.replaceAll('\\', '\\\\').replaceAll("'", "\\'"),
  };
}

/** The config's `contract:` entry for a contribution that gives none. */
export function defaultContractEntry(
  configModule: string,
  input: ContractEntryInput,
): ConfigExpression {
  if (input.kind === 'prisma7-schema') {
    return {
      renderTypeScript: () => `prisma7Schema(${JSON.stringify(input.path)})`,
      importRequirements: () => [{ moduleSpecifier: configModule, symbol: 'prisma7Schema' }],
    };
  }
  return {
    renderTypeScript: () => JSON.stringify(input.path),
    importRequirements: () => [],
  };
}

/**
 * `prisma.config.ts`, with `contract` as its contract entry. `output` is the directory the
 * contract is emitted into, written only when it is given; the target package names the files.
 */
export function configFile(options: {
  readonly configModule: string;
  readonly contract: ConfigExpression;
  readonly output: string | undefined;
}): string {
  const imports = renderImports(
    [
      { moduleSpecifier: '@prisma/cli-engine', symbol: 'definePrismaConfig' },
      { moduleSpecifier: options.configModule, symbol: 'defineConfig', alias: 'ormConfig' },
      ...options.contract.importRequirements(),
    ].map(escapedForSingleQuotes),
  );
  const output =
    options.output === undefined ? '' : `\n    output: ${JSON.stringify(options.output)},`;
  return `import 'dotenv/config';
${imports}

export default definePrismaConfig({
  orm: ormConfig({
    contract: ${options.contract.renderTypeScript()},${output}
    db: {
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
`;
}
