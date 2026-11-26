import type { JsonValue } from '@internal/utils/json';
import { type } from 'arktype';
import { errorInitContributionUnavailable } from './errors';
import type {
  ContractEntryExpression,
  ContractEntryInput,
  InitContribution,
} from './init-contribution';
import {
  CONFIG_FILE_GLOBALS,
  configFile,
  configFileImports,
  defaultContractEntry,
} from './templates/code-templates';

const ContractEntrySchema = type({ value: 'unknown', '+': 'reject' }).or({
  call: {
    moduleSpecifier: 'string',
    symbol: /^[A-Za-z_$][\w$]*$/,
    args: 'unknown[]',
    '+': 'reject',
  },
  '+': 'reject',
});

/** Words that cannot name an import binding in a module, which is strict mode code. */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

function holdsControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
  });
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value !== 'object') {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every(isJsonValue)
  );
}

/** The package an init contribution came from, for the refusal of a malformed entry. */
export interface ContributionOwner {
  readonly packageName: string;
  readonly unlisted: boolean;
}

/** Why a call cannot be written into the config, or `undefined` when it can. */
function unwritableCall(
  call: { readonly moduleSpecifier: string; readonly symbol: string },
  configModule: string,
): string | undefined {
  if (call.moduleSpecifier.trim() === '' || holdsControlCharacter(call.moduleSpecifier)) {
    return `a call from the module ${JSON.stringify(call.moduleSpecifier)}, which is empty or holds a line break or another control character`;
  }
  if (RESERVED_WORDS.has(call.symbol)) {
    return `a call of ${call.symbol}, a reserved word that cannot be imported by name`;
  }
  if (CONFIG_FILE_GLOBALS.includes(call.symbol)) {
    return `a call of ${call.symbol}, a global prisma.config.ts reads, which an import would hide`;
  }
  const bound = configFileImports(configModule).find(
    (requirement) => (requirement.alias ?? requirement.symbol) === call.symbol,
  );
  if (
    bound !== undefined &&
    (bound.alias !== undefined || bound.moduleSpecifier !== call.moduleSpecifier)
  ) {
    return `a call of ${call.symbol} from ${call.moduleSpecifier}, a name prisma.config.ts already imports`;
  }
  return undefined;
}

/**
 * The contribution's `contract:` entry for `input`, or the CLI's own when it gives none. The
 * contribution comes from another package, so what it returns is checked here.
 */
export function contractEntryFor(
  contribution: InitContribution,
  input: ContractEntryInput,
  owner: ContributionOwner,
): ContractEntryExpression {
  if (contribution.contractEntry === undefined) {
    return defaultContractEntry(contribution.configModule, input);
  }
  const malformed = (detail: string) =>
    errorInitContributionUnavailable({
      packageName: owner.packageName,
      reason: 'invalid-shape',
      detail: `its contractEntry returned ${detail}`,
      unlisted: owner.unlisted,
      missingPeers: [],
      missingPeersCommand: undefined,
    });

  const returned: unknown = contribution.contractEntry(input);
  const entry = ContractEntrySchema(returned);
  if (entry instanceof type.errors) {
    throw malformed(
      `neither { value } nor { call: { moduleSpecifier, symbol, args } } (${entry.summary})`,
    );
  }
  if ('value' in entry) {
    const { value } = entry;
    if (!isJsonValue(value)) {
      throw malformed('a value that is not JSON');
    }
    return { value };
  }
  const { moduleSpecifier, symbol, args } = entry.call;
  const unwritable = unwritableCall(entry.call, contribution.configModule);
  if (unwritable !== undefined) {
    throw malformed(unwritable);
  }
  if (!args.every(isJsonValue)) {
    throw malformed(`a call of ${symbol} with an argument that is not JSON`);
  }
  return { call: { moduleSpecifier, symbol, args } };
}

/** `prisma.config.ts` as `init` writes it: the contribution's contract entry for `input`, checked. */
export function initConfigFile(options: {
  readonly contribution: InitContribution;
  readonly input: ContractEntryInput;
  readonly owner: ContributionOwner;
  /** The directory the contract is emitted into; `undefined` leaves it to the target package. */
  readonly output: string | undefined;
}): string {
  return configFile({
    configModule: options.contribution.configModule,
    contract: contractEntryFor(options.contribution, options.input, options.owner),
    output: options.output,
  });
}
