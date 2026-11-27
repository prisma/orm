import type {
  ConfigModuleExports,
  ContractEntryInput,
  ContractEntryNode,
} from '@internal/cli/init-contribution';
import { POSTGRES_NEWEST_VERSION } from '@internal/target-postgres/server-version-range';
import {
  type ImportRequirement,
  jsonToTsSource,
  TsExpression,
  tsObjectSource,
} from '@internal/ts-render';
import { InternalError } from '@internal/utils/internal-error';
import { moduleBase } from '../config/module-base';

export const configModule = `${moduleBase}/config`;

/** `name` from `exports`, refusing an export the module does not have. */
function exportOf(exports: ConfigModuleExports, name: string, module: string): unknown {
  if (!Object.hasOwn(exports, name)) {
    throw new InternalError(
      `${module} exports no ${name}, which the config's contract entry imports.`,
    );
  }
  return exports[name];
}

/** The required capabilities of a new project: the newest PostgreSQL version's list and the driver's, spread into one array and imported from `module`. */
export class RequiredCapabilitiesList extends TsExpression {
  readonly #lists = [`postgres${POSTGRES_NEWEST_VERSION}`, 'postgresDriver'] as const;

  constructor(private readonly module: string) {
    super();
  }

  renderTypeScript(): string {
    return `[${this.#lists.map((list) => `...${list}`).join(', ')}]`;
  }

  importRequirements(): readonly ImportRequirement[] {
    return this.#lists.map((symbol) => ({ moduleSpecifier: this.module, symbol }));
  }

  /** The list the rendered array holds, from the exports of `module`. */
  valueIn(exports: ConfigModuleExports): unknown[] {
    return this.#lists.flatMap((list) => {
      const keys = exportOf(exports, list, this.module);
      if (!Array.isArray(keys)) {
        throw new InternalError(`${this.module} exports a ${list} that is not a list.`);
      }
      return keys;
    });
  }
}

/** A call of `callee` with arguments that are already source, on one line when it fits and one argument per line when it does not. */
function callSource(callee: string, args: readonly string[]): string {
  const singleLine = `${callee}(${args.join(', ')})`;
  if (singleLine.length <= 80 && !singleLine.includes('\n')) return singleLine;
  return `${callee}(\n${args.map((arg) => `  ${arg}`).join(',\n')},\n)`;
}

/** A TypeScript contract's entry: its path, since the contract lists its required capabilities in `defineContract`. */
class TypeScriptContractEntry extends TsExpression implements ContractEntryNode {
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

/** A Prisma schema's entry: its path and the capabilities it requires. */
class PrismaSchemaContractEntry extends TsExpression implements ContractEntryNode {
  readonly #required = new RequiredCapabilitiesList(configModule);

  constructor(private readonly path: string) {
    super();
  }

  renderTypeScript(): string {
    return tsObjectSource([
      ['path', jsonToTsSource(this.path)],
      ['requiredCapabilities', this.#required.renderTypeScript()],
    ]);
  }

  importRequirements(): readonly ImportRequirement[] {
    return this.#required.importRequirements();
  }

  contractValue(exports: ConfigModuleExports): unknown {
    return { path: this.path, requiredCapabilities: this.#required.valueIn(exports) };
  }
}

/** A Prisma 7 schema's entry: `prisma7Schema` with the path and the capabilities it requires. */
class Prisma7SchemaContractEntry extends TsExpression implements ContractEntryNode {
  readonly #required = new RequiredCapabilitiesList(configModule);

  constructor(private readonly path: string) {
    super();
  }

  renderTypeScript(): string {
    return callSource('prisma7Schema', [
      jsonToTsSource(this.path),
      tsObjectSource([['requiredCapabilities', this.#required.renderTypeScript()]]),
    ]);
  }

  importRequirements(): readonly ImportRequirement[] {
    return [
      { moduleSpecifier: configModule, symbol: 'prisma7Schema' },
      ...this.#required.importRequirements(),
    ];
  }

  contractValue(exports: ConfigModuleExports): unknown {
    const prisma7Schema = exportOf(exports, 'prisma7Schema', configModule);
    if (typeof prisma7Schema !== 'function') {
      throw new InternalError(`${configModule} exports a prisma7Schema that is not a function.`);
    }
    return prisma7Schema(this.path, { requiredCapabilities: this.#required.valueIn(exports) });
  }
}

/** The config's `contract:` entry for `input`. */
export function contractEntry(input: ContractEntryInput): ContractEntryNode {
  if (input.kind === 'prisma7-schema') {
    return new Prisma7SchemaContractEntry(input.path);
  }
  return input.mode === 'typescript'
    ? new TypeScriptContractEntry(input.path)
    : new PrismaSchemaContractEntry(input.path);
}
