import { readFile } from 'node:fs/promises';
import type { PerSpacePlan } from '@internal/migration-tools/aggregate';
import { join } from 'pathe';

/**
 * The directory of the first migration to apply whose `migration.ts` still calls `placeholder(...)`.
 * `migration plan` writes such a migration with an empty `ops.json`, and `node migration.ts` writes
 * none until every placeholder is filled, so only a migration with no operations is read. A call of
 * `placeholder` from another file the migration imports is not found.
 */
export async function migrationWithUnfilledPlaceholders(
  plans: ReadonlyMap<string, PerSpacePlan>,
  applyOrder: readonly string[],
  migrationsDir: string,
): Promise<string | undefined> {
  for (const spaceId of applyOrder) {
    for (const edge of plans.get(spaceId)?.migrationEdges ?? []) {
      if (edge.operationCount !== 0) continue;
      const directory = join(migrationsDir, spaceId, edge.dirName);
      if (callsPlaceholder(await migrationSource(directory))) return directory;
    }
  }
  return undefined;
}

async function migrationSource(directory: string): Promise<string> {
  try {
    return await readFile(join(directory, 'migration.ts'), 'utf-8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return '';
    throw error;
  }
}

type Token =
  | { readonly kind: 'name'; readonly text: string }
  | { readonly kind: 'string'; readonly text: string }
  | { readonly kind: 'punctuation'; readonly text: string };

const PRISMA_MIGRATION_MODULE = /^@(prisma|internal)\/.+\/migration$/;
const NAME_START = /[A-Za-z_$]/;
const NAME_PART = /[\w$]/;

/**
 * Whether the source calls the `placeholder` it imports from a Prisma migration module, by the
 * local name it imports it under or through a namespace import. Comments and the text of strings
 * are not code, so a `placeholder(` there is not a call.
 */
function callsPlaceholder(source: string): boolean {
  const tokens = tokenize(source);
  const { names, namespaces } = placeholderImports(tokens);
  return tokens.some((token, index) => {
    if (tokens[index + 1]?.text !== '(' || token.kind !== 'name') return false;
    const before = tokens[index - 1];
    if (before?.text !== '.') return names.has(token.text);
    const owner = tokens[index - 2];
    return token.text === 'placeholder' && owner?.kind === 'name' && namespaces.has(owner.text);
  });
}

function placeholderImports(tokens: readonly Token[]): {
  readonly names: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
} {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  tokens.forEach((token, index) => {
    if (token.kind !== 'name' || token.text !== 'import') return;
    const fromAt = tokens.findIndex(
      (each, at) => at > index && each.kind === 'name' && each.text === 'from',
    );
    const module = tokens[fromAt + 1];
    if (fromAt < 0 || module?.kind !== 'string' || !PRISMA_MIGRATION_MODULE.test(module.text)) {
      return;
    }
    const clause = tokens.slice(index + 1, fromAt);
    if (clause[0]?.text === '*' && clause[1]?.text === 'as' && clause[2] !== undefined) {
      namespaces.add(clause[2].text);
      return;
    }
    clause.forEach((each, at) => {
      if (each.text !== 'placeholder') return;
      const alias = clause[at + 1]?.text === 'as' ? clause[at + 2] : undefined;
      names.add(alias?.text ?? each.text);
    });
  });
  return { names, namespaces };
}

/** The names, strings and punctuation of the source, with comments left out and template expressions read as code. */
function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let at = 0;
  const templateDepths: number[] = [];
  let depth = 0;

  const readTemplate = () => {
    while (at < source.length) {
      const char = source[at];
      if (char === '\\') at += 2;
      else if (char === '`') {
        at += 1;
        return;
      } else if (char === '$' && source[at + 1] === '{') {
        at += 2;
        templateDepths.push(depth);
        depth += 1;
        return;
      } else at += 1;
    }
  };

  while (at < source.length) {
    const char = source[at] ?? '';
    const next = source[at + 1];
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', at);
      at = end < 0 ? source.length : end;
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', at + 2);
      at = end < 0 ? source.length : end + 2;
    } else if (char === "'" || char === '"') {
      let text = '';
      at += 1;
      while (at < source.length && source[at] !== char) {
        if (source[at] === '\\') at += 1;
        text += source[at] ?? '';
        at += 1;
      }
      at += 1;
      tokens.push({ kind: 'string', text });
    } else if (char === '`') {
      at += 1;
      readTemplate();
    } else if (NAME_START.test(char)) {
      const start = at;
      while (at < source.length && NAME_PART.test(source[at] ?? '')) at += 1;
      tokens.push({ kind: 'name', text: source.slice(start, at) });
    } else if (/\s/.test(char)) {
      at += 1;
    } else {
      at += 1;
      if (char === '{') depth += 1;
      if (char === '}') {
        depth -= 1;
        if (templateDepths.at(-1) === depth) {
          templateDepths.pop();
          readTemplate();
          continue;
        }
      }
      tokens.push({ kind: 'punctuation', text: char });
    }
  }
  return tokens;
}
