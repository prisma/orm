import {
  type ContractSourceFormat,
  DEFAULT_CONTRACT_SOURCE_DIR,
} from '@internal/config/config-types';
import { type ImportRequirement, jsonToTsSource, renderImports } from '@internal/ts-render';
import type { ContractEntry, ContractEntryInput } from '../init-contribution';

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
): ContractEntry {
  if (input.kind === 'prisma7-schema') {
    return { call: { module: configModule, export: 'prisma7Schema', args: [input.path] } };
  }
  return { value: input.path };
}

function contractSource(entry: ContractEntry): string {
  if ('value' in entry) {
    return jsonToTsSource(entry.value);
  }
  return `${entry.call.export}(${entry.call.args.map(jsonToTsSource).join(', ')})`;
}

function contractImports(entry: ContractEntry): readonly ImportRequirement[] {
  return 'call' in entry ? [{ moduleSpecifier: entry.call.module, symbol: entry.call.export }] : [];
}

/**
 * `prisma.config.ts`, with `contract` as its contract entry. `output` is the directory the
 * contract is emitted into, written only when it is given; the target package names the files.
 */
export function configFile(options: {
  readonly configModule: string;
  readonly contract: ContractEntry;
  readonly output: string | undefined;
}): string {
  const imports = renderImports(
    [
      { moduleSpecifier: '@prisma/cli-engine', symbol: 'definePrismaConfig' },
      { moduleSpecifier: options.configModule, symbol: 'defineConfig', alias: 'ormConfig' },
      ...contractImports(options.contract),
    ].map(escapedForSingleQuotes),
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
