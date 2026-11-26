import {
  type ContractSourceFormat,
  DEFAULT_CONTRACT_SOURCE_DIR,
} from '@internal/config/config-types';
import { type ImportRequirement, jsonToTsSource, renderImports } from '@internal/ts-render';
import type { ContractEntryExpression, ContractEntryInput } from '../init-contribution';

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
): ContractEntryExpression {
  if (input.kind === 'prisma7-schema') {
    return { call: { moduleSpecifier: configModule, symbol: 'prisma7Schema', args: [input.path] } };
  }
  return { value: input.path };
}

function contractSource(entry: ContractEntryExpression): string {
  if ('value' in entry) {
    return jsonToTsSource(entry.value);
  }
  return `${entry.call.symbol}(${entry.call.args.map(jsonToTsSource).join(', ')})`;
}

function contractImports(entry: ContractEntryExpression): readonly ImportRequirement[] {
  return 'call' in entry
    ? [{ moduleSpecifier: entry.call.moduleSpecifier, symbol: entry.call.symbol }]
    : [];
}

/** The globals the config reads; an import of the same name would hide them. */
export const CONFIG_FILE_GLOBALS: readonly string[] = ['process'];

/** The imports the config always has; the names they bind cannot be taken by the contract entry. */
export function configFileImports(configModule: string): readonly ImportRequirement[] {
  return [
    { moduleSpecifier: '@prisma/cli-engine', symbol: 'definePrismaConfig' },
    { moduleSpecifier: configModule, symbol: 'defineConfig', alias: 'ormConfig' },
  ];
}

/**
 * `prisma.config.ts`, with `contract` as its contract entry. `output` is the directory the
 * contract is emitted into, written only when it is given; the target package names the files.
 */
export function configFile(options: {
  readonly configModule: string;
  readonly contract: ContractEntryExpression;
  readonly output: string | undefined;
}): string {
  const imports = renderImports(
    [...configFileImports(options.configModule), ...contractImports(options.contract)].map(
      escapedForSingleQuotes,
    ),
  );
  const output =
    options.output === undefined ? '' : `\n    output: ${JSON.stringify(options.output)},`;
  return `import 'dotenv/config';
${imports}

export default definePrismaConfig({
  orm: ormConfig({
    contract: ${contractSource(options.contract)},${output}
    db: {
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
`;
}
