import { type ImportRequirement, TsExpression } from '@internal/ts-render';
import { InternalError } from '@internal/utils/internal-error';
import { defaultRequiredCapabilityLists } from './default-required-capability-lists';

/** The exports of the module the lists are imported from, as `init` and the CLI hand them over. */
export type CapabilityListModuleExports = Readonly<Record<string, unknown>>;

/** `name` from `exports`, refusing an export the module does not have. */
export function exportOf(
  exports: CapabilityListModuleExports,
  name: string,
  module: string,
): unknown {
  if (!Object.hasOwn(exports, name)) {
    throw new InternalError(
      `${module} exports no ${name}, which the config's contract entry imports.`,
    );
  }
  return exports[name];
}

/** The required capabilities of a new project: the newest PostgreSQL version's list and the driver's, spread into one array and imported from `module`. */
export class RequiredCapabilitiesList extends TsExpression {
  readonly #lists = defaultRequiredCapabilityLists;

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
  valueIn(exports: CapabilityListModuleExports): unknown[] {
    return this.#lists.flatMap((list) => {
      const keys = exportOf(exports, list, this.module);
      if (!Array.isArray(keys)) {
        throw new InternalError(`${this.module} exports a ${list} that is not a list.`);
      }
      return keys;
    });
  }
}
