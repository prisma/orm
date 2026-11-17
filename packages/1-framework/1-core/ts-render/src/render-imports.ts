import { compareCodeUnits } from '@internal/contract/hashing-utils';
import { contractError } from './contract-errors';
import type { ImportRequirement } from './ts-expression';

/**
 * Render an aggregated `import` block from a flat list of
 * `ImportRequirement`s. Each target's migration renderer collects
 * requirements polymorphically from its call nodes and pipes them here.
 *
 * The emitter invariants:
 *
 * - **Usually one line per module specifier.** Named imports are aggregated
 *   and emitted sorted; a single default symbol is combined onto the same
 *   line when attributes agree (`import def, { a, b } from "m";`). Aliased
 *   symbols render `symbol as alias`. When every symbol for a module is
 *   `typeOnly`, the statement collapses to `import type { … }`; a module
 *   mixing value and type symbols prefixes the type-only ones
 *   (`import { type T, v }`). Exceptions that split into multiple lines: a
 *   fully type-only statement with both a default and one or more named
 *   bindings (`import type D from "m";` then `import type { N } from "m";`,
 *   because TypeScript rejects `import type D, { N } from "m"` — TS1363),
 *   and multiple distinct default symbols (see below).
 * - **Multiple distinct default symbols per module are allowed.** JS permits
 *   re-importing the same specifier under different default-binding names
 *   (`import a from 'm'; import b from 'm';`), so each distinct default
 *   symbol renders its own `import` line, sorted alphabetically; a repeated
 *   requirement for the same symbol still collapses into one binding,
 *   merging `typeOnly` by AND.
 * - **Attribute unanimity per module.** All requirements for the same
 *   module specifier must carry the same (or no) `attributes` map.
 *   Divergent attribute maps throw — they can't collapse to one line
 *   and there's no user-resolvable recovery at this layer.
 * - **Distinct (symbol, alias) pairs are distinct bindings.** TypeScript
 *   permits importing the same export under multiple local names, so
 *   `{ A }` + `{ A as B }` renders as `import { A, A as B } from "m"` and
 *   `{ A as B }` + `{ A as C }` renders as `import { A as B, A as C } from "m"`.
 *   Truly identical `(symbol, alias)` pairs still collapse to one binding,
 *   merging `typeOnly` by AND.
 * - **Deterministic ordering.** Modules are emitted sorted by specifier;
 *   within a module, named bindings are emitted sorted by `(symbol, alias)`
 *   using JavaScript code-unit comparison, with the un-aliased form (no
 *   alias) treated as alias `""` so it sorts before any aliased form of the
 *   same symbol.
 *
 * Returns a string containing one or more import lines per module (see the
 * splitting exceptions above), joined by `\n` (no trailing newline). An
 * empty requirement list returns `""`.
 */
export function renderImports(requirements: readonly ImportRequirement[]): string {
  const byModule = aggregateByModule(requirements);
  const entries = [...byModule.entries()].sort(([a], [b]) => compareCodeUnits(a, b));
  return entries
    .map(([moduleSpecifier, group]) => renderModuleImport(moduleSpecifier, group))
    .join('\n');
}

interface NamedBinding {
  symbol: string;
  alias: string | null;
  typeOnly: boolean;
}

interface ModuleImportGroup {
  readonly named: Map<string, NamedBinding>;
  readonly defaults: Map<string, boolean>;
  attributes: Readonly<Record<string, string>> | null;
  attributesSet: boolean;
}

function aggregateByModule(
  requirements: readonly ImportRequirement[],
): Map<string, ModuleImportGroup> {
  const byModule = new Map<string, ModuleImportGroup>();
  for (const req of requirements) {
    let group = byModule.get(req.moduleSpecifier);
    if (!group) {
      group = {
        named: new Map(),
        defaults: new Map(),
        attributes: null,
        attributesSet: false,
      };
      byModule.set(req.moduleSpecifier, group);
    }
    mergeRequirementIntoGroup(req, group);
  }
  return byModule;
}

function mergeRequirementIntoGroup(req: ImportRequirement, group: ModuleImportGroup): void {
  const kind = req.kind ?? 'named';
  const typeOnly = req.typeOnly === true;
  if (kind === 'default') {
    const existingTypeOnly = group.defaults.get(req.symbol);
    group.defaults.set(
      req.symbol,
      existingTypeOnly === undefined ? typeOnly : existingTypeOnly && typeOnly,
    );
  } else {
    const alias = req.alias && req.alias !== req.symbol ? req.alias : null;
    const key = namedBindingKey(req.symbol, alias);
    const existing = group.named.get(key);
    if (existing) {
      existing.typeOnly = existing.typeOnly && typeOnly;
    } else {
      group.named.set(key, { symbol: req.symbol, alias, typeOnly });
    }
  }
  mergeAttributes(req, group);
}

function mergeAttributes(req: ImportRequirement, group: ModuleImportGroup): void {
  const incoming = req.attributes ?? null;
  if (!group.attributesSet) {
    group.attributes = incoming;
    group.attributesSet = true;
    return;
  }
  if (!attributesEqual(group.attributes, incoming)) {
    throw contractError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Conflicting import attributes for module "${req.moduleSpecifier}": ` +
        `${stringifyAttributes(group.attributes)} vs ${stringifyAttributes(incoming)}.`,
      { meta: { moduleSpecifier: req.moduleSpecifier } },
    );
  }
}

function attributesEqual(
  a: Readonly<Record<string, string>> | null,
  b: Readonly<Record<string, string>> | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const key = aKeys[i];
    if (key !== bKeys[i]) return false;
    if (a[key as string] !== b[key as string]) return false;
  }
  return true;
}

function stringifyAttributes(attrs: Readonly<Record<string, string>> | null): string {
  if (attrs === null) return '(none)';
  const entries = Object.entries(attrs)
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `{ ${entries.join(', ')} }`;
}

function renderModuleImport(moduleSpecifier: string, group: ModuleImportGroup): string {
  const attrs = buildAttributesClause(group.attributes);
  const defaultEntries = [...group.defaults.entries()].sort(([a], [b]) => compareCodeUnits(a, b));
  const hasNamed = group.named.size > 0;

  // More than one distinct default symbol can't share a single import
  // clause (`import a, b from 'm'` isn't valid syntax), so each gets its
  // own line; named bindings (if any) follow on their own line.
  if (defaultEntries.length > 1) {
    const defaultLines = defaultEntries.map(
      ([symbol, typeOnly]) =>
        `import ${typeOnly ? 'type ' : ''}${symbol} from '${moduleSpecifier}'${attrs};`,
    );
    if (!hasNamed) return defaultLines.join('\n');
    return [...defaultLines, renderNamedOnlyStatement(moduleSpecifier, group, attrs)].join('\n');
  }

  const defaultEntry = defaultEntries[0];
  const hasDefault = defaultEntry !== undefined;
  const [defaultSymbol, defaultTypeOnly] = defaultEntry ?? [null, true];
  const typeOnlyStatement = isStatementTypeOnly(hasDefault, defaultTypeOnly, group);
  if (typeOnlyStatement && hasDefault && hasNamed) {
    const defaultLine = `import type ${defaultSymbol} from '${moduleSpecifier}'${attrs};`;
    const namedClause = renderNamedBindingsList(group, true);
    const namedLine = `import type { ${namedClause} } from '${moduleSpecifier}'${attrs};`;
    return `${defaultLine}\n${namedLine}`;
  }
  const keyword = typeOnlyStatement ? 'import type' : 'import';
  const clause = buildImportClause(defaultSymbol, group, typeOnlyStatement);
  return `${keyword} ${clause} from '${moduleSpecifier}'${attrs};`;
}

function renderNamedOnlyStatement(
  moduleSpecifier: string,
  group: ModuleImportGroup,
  attrs: string,
): string {
  const typeOnlyStatement = [...group.named.values()].every((binding) => binding.typeOnly);
  const keyword = typeOnlyStatement ? 'import type' : 'import';
  const namedClause = renderNamedBindingsList(group, typeOnlyStatement);
  return `${keyword} { ${namedClause} } from '${moduleSpecifier}'${attrs};`;
}

function isStatementTypeOnly(
  hasDefault: boolean,
  defaultTypeOnly: boolean,
  group: ModuleImportGroup,
): boolean {
  const hasNamed = group.named.size > 0;
  if (!hasDefault && !hasNamed) return false;
  if (hasDefault && !defaultTypeOnly) return false;
  for (const binding of group.named.values()) {
    if (!binding.typeOnly) return false;
  }
  return true;
}

function buildImportClause(
  defaultSymbol: string | null,
  group: ModuleImportGroup,
  statementTypeOnly: boolean,
): string {
  const hasNamed = group.named.size > 0;
  const hasDefault = defaultSymbol !== null;
  const namedClause = hasNamed ? renderNamedBindingsList(group, statementTypeOnly) : '';
  if (hasDefault && hasNamed) {
    return `${defaultSymbol}, { ${namedClause} }`;
  }
  if (hasDefault) {
    return defaultSymbol;
  }
  return `{ ${namedClause} }`;
}

function renderNamedBindingsList(group: ModuleImportGroup, statementTypeOnly: boolean): string {
  return [...group.named.values()]
    .sort(compareNamedBindings)
    .map((binding) => renderNamedBinding(binding, statementTypeOnly))
    .join(', ');
}

function compareNamedBindings(a: NamedBinding, b: NamedBinding): number {
  return compareCodeUnits(a.symbol, b.symbol) || compareCodeUnits(a.alias ?? '', b.alias ?? '');
}

function namedBindingKey(symbol: string, alias: string | null): string {
  return `${symbol}\x00${alias ?? ''}`;
}

function renderNamedBinding(binding: NamedBinding, statementTypeOnly: boolean): string {
  const prefix = !statementTypeOnly && binding.typeOnly ? 'type ' : '';
  const aliasClause = binding.alias !== null ? ` as ${binding.alias}` : '';
  return `${prefix}${binding.symbol}${aliasClause}`;
}

function buildAttributesClause(attrs: Readonly<Record<string, string>> | null): string {
  if (attrs === null) return '';
  const entries = Object.entries(attrs)
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  if (entries.length === 0) return '';
  return ` with { ${entries.join(', ')} }`;
}
