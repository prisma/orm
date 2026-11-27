import {
  type ImportRequirement,
  jsonToTsSource,
  TsExpression,
  tsObjectSource,
} from '@internal/ts-render';
import { InternalError } from '@internal/utils/internal-error';
import {
  type CapabilityListModuleExports,
  exportOf,
  RequiredCapabilitiesList,
} from '../contract/required-capabilities-list';
import { configModule } from './module-base';

/** A call of `callee` with arguments that are already source, on one line when it fits and one argument per line when it does not. */
function callSource(callee: string, args: readonly string[]): string {
  const singleLine = `${callee}(${args.join(', ')})`;
  if (singleLine.length <= 80 && !singleLine.includes('\n')) return singleLine;
  return `${callee}(\n${args.map((arg) => `  ${arg}`).join(',\n')},\n)`;
}

/** A TypeScript contract's entry: its path, since the contract lists its required capabilities in `defineContract`. */
export class TypeScriptContractEntry extends TsExpression {
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
export class PrismaSchemaContractEntry extends TsExpression {
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

  contractValue(exports: CapabilityListModuleExports): unknown {
    return { path: this.path, requiredCapabilities: this.#required.valueIn(exports) };
  }
}

/** A Prisma 7 schema's entry: `prisma7Schema` with the path and the capabilities it requires. */
export class Prisma7SchemaContractEntry extends TsExpression {
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

  contractValue(exports: CapabilityListModuleExports): unknown {
    const prisma7Schema = exportOf(exports, 'prisma7Schema', configModule);
    if (typeof prisma7Schema !== 'function') {
      throw new InternalError(`${configModule} exports a prisma7Schema that is not a function.`);
    }
    return prisma7Schema(this.path, { requiredCapabilities: this.#required.valueIn(exports) });
  }
}
