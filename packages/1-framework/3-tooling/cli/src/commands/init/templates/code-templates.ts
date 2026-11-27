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
import { InternalError } from '@internal/utils/internal-error';
import type {
  ConfigModuleExports,
  ContractEntryInput,
  ContractEntryNode,
} from '../init-contribution';

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

class ContractPathEntry extends TsExpression implements ContractEntryNode {
  constructor(private readonly path: string) {
    super();
  }

  renderTypeScript(): string {
    return jsonToTsSource(this.path);
  }

  importRequirements(): readonly ImportRequirement[] {
    return [];
  }

  contractValue(): unknown {
    return this.path;
  }
}

class Prisma7SchemaEntry extends TsExpression implements ContractEntryNode {
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

  contractValue(exports: ConfigModuleExports): unknown {
    const prisma7Schema = exports['prisma7Schema'];
    if (typeof prisma7Schema !== 'function') {
      throw new InternalError(
        `${this.configModule} exports no prisma7Schema function, which the config's contract entry imports.`,
      );
    }
    return prisma7Schema(this.path);
  }
}

/** The config's `contract:` entry for a contribution that gives none: the path, or `prisma7Schema(<path>)` from `configModule`. */
export function defaultContractEntry(
  configModule: string,
  input: ContractEntryInput,
): ContractEntryNode {
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
  readonly contract: ContractEntryNode;
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
    contract: ${options.contract.renderTypeScript().replaceAll('\n', '\n    ')},${output}
    db: {
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
`;
}
