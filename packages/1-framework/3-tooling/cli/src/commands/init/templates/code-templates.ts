import {
  type ContractSourceFormat,
  DEFAULT_CONTRACT_SOURCE_DIR,
} from '@internal/config/config-types';
import {
  type ImportRequirement,
  jsonToTsSource,
  renderImports,
  TsExpression,
} from '@internal/ts-render';
import type { ContractEntryInput } from '../init-contribution';

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

/** What `prisma.config.ts` writes as its `contract:` entry, with the imports it needs. */
export type RenderedContractEntry = Pick<TsExpression, 'renderTypeScript' | 'importRequirements'>;

class ContractPathEntry extends TsExpression {
  constructor(private readonly path: string) {
    super();
  }

  renderTypeScript(): string {
    return jsonToTsSource(this.path);
  }

  importRequirements(): readonly ImportRequirement[] {
    return [];
  }
}

class Prisma7SchemaEntry extends TsExpression {
  constructor(
    private readonly configModule: string,
    private readonly path: string,
  ) {
    super();
  }

  renderTypeScript(): string {
    return `prisma7Schema(${jsonToTsSource(this.path)})`;
  }

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: this.configModule, symbol: 'prisma7Schema' }];
  }
}

/** The config's `contract:` entry for a contribution that gives none: the path, or `prisma7Schema(<path>)` from `configModule`. */
export function defaultContractEntry(
  configModule: string,
  input: ContractEntryInput,
): RenderedContractEntry {
  return input.kind === 'prisma7-schema'
    ? new Prisma7SchemaEntry(configModule, input.path)
    : new ContractPathEntry(input.path);
}

function configFileImports(configModule: string): readonly ImportRequirement[] {
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
  readonly contract: RenderedContractEntry;
  readonly output: string | undefined;
}): string {
  const imports = renderImports(
    [...configFileImports(options.configModule), ...options.contract.importRequirements()].map(
      escapedForSingleQuotes,
    ),
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
