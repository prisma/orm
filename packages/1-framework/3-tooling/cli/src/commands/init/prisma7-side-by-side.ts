import { blindCast } from '@internal/utils/casts';

const PRISMA7_PACKAGE_CONFIG_SPECIFIER = '@prisma/prisma7/config';

/**
 * Points a Prisma 7 config at the Prisma 7 package's config entrypoint. Both
 * quote styles are rewritten; `found` is false when the file imports neither.
 */
export function rewritePrisma7ConfigImport(content: string): {
  readonly content: string;
  readonly found: boolean;
} {
  const rewritten = content.replace(
    /(['"])prisma\/config\1/g,
    (_match, quote: string) => `${quote}${PRISMA7_PACKAGE_CONFIG_SPECIFIER}${quote}`,
  );
  return { content: rewritten, found: rewritten !== content };
}

/**
 * One shell token: a quoted string (to the end of the script when unterminated),
 * a backslash escape, a command operator, whitespace, or a run of other characters.
 */
const SHELL_TOKEN =
  /"(?:\\[\s\S]|[^"\\])*(?:"|$)|'[^']*(?:'|$)|\\[\s\S]?|&&|\|\||[;|]|\s+|[^\s"'\\;|&]+|&/g;

const SHELL_OPERATORS: ReadonlySet<string> = new Set(['&&', '||', ';', '|']);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

interface PrefixWrapper {
  readonly words: readonly string[];
  /** Flags that may follow the wrapper because they do not change whose `prisma` runs. */
  readonly flags: readonly string[];
}

/** Wrappers whose next word, after any `NAME=value` assignments, is the command they run. */
const PREFIX_WRAPPERS: readonly PrefixWrapper[] = [
  { words: ['pnpm', 'exec'], flags: [] },
  { words: ['pnpm', 'dlx'], flags: [] },
  { words: ['pnpm'], flags: [] },
  { words: ['yarn', 'exec'], flags: [] },
  { words: ['yarn', 'dlx'], flags: [] },
  { words: ['yarn'], flags: [] },
  { words: ['bun', 'x'], flags: ['--bun'] },
  { words: ['bun'], flags: [] },
  { words: ['bunx'], flags: ['--bun'] },
  { words: ['npx'], flags: ['-y', '--yes'] },
  { words: ['cross-env'], flags: [] },
];

/** Wrappers that take their own arguments and run the command after `--`. */
const SEPARATOR_WRAPPERS: readonly (readonly string[])[] = [
  ['dotenv'],
  ['dotenvx', 'run'],
  ['env-cmd'],
];

interface Word {
  readonly text: string;
  readonly end: number;
}

/**
 * Splits a script into commands at the operators outside quotes, and each
 * command into words. A quoted string belongs to the word it sits in, so no
 * word inside quotes is ever a command.
 */
function commandsOf(script: string): Word[][] {
  let words: Word[] = [];
  const commands = [words];
  let inWord = false;
  for (const token of script.matchAll(SHELL_TOKEN)) {
    const [text] = token;
    if (SHELL_OPERATORS.has(text)) {
      words = [];
      commands.push(words);
      inWord = false;
    } else if (/^\s/.test(text)) {
      inWord = false;
    } else {
      const previous = inWord ? (words.pop()?.text ?? '') : '';
      words.push({ text: `${previous}${text}`, end: token.index + text.length });
      inWord = true;
    }
  }
  return commands;
}

function startsWithWords(words: readonly Word[], at: number, expected: readonly string[]): boolean {
  return expected.every((part, offset) => words[at + offset]?.text === part);
}

/**
 * The `prisma` word that runs as the command starting at `at`: skips
 * `NAME=value` assignments, then either is `prisma` or unwraps a recognised
 * wrapper and looks again at the command it runs.
 */
function prismaCommandWord(words: readonly Word[], at: number): Word | undefined {
  let index = at;
  while (ENV_ASSIGNMENT.test(words[index]?.text ?? '')) {
    index += 1;
  }
  const word = words[index];
  if (word?.text === 'prisma') {
    return word;
  }
  const prefix = PREFIX_WRAPPERS.find((wrapper) => startsWithWords(words, index, wrapper.words));
  if (prefix !== undefined) {
    let next = index + prefix.words.length;
    while (prefix.flags.includes(words[next]?.text ?? '')) {
      next += 1;
    }
    return prismaCommandWord(words, next);
  }
  const separated = SEPARATOR_WRAPPERS.find((wrapper) => startsWithWords(words, index, wrapper));
  if (separated === undefined) {
    return undefined;
  }
  const separator = words.findIndex(
    (candidate, position) => position >= index + separated.length && candidate.text === '--',
  );
  return separator === -1 ? undefined : prismaCommandWord(words, separator + 1);
}

/**
 * Rewrites `prisma` to `prisma7` wherever it is the command a script runs: at
 * the start of the script or after `&&`, `||`, `;`, or `|` outside quotes,
 * behind any `NAME=value` assignments and recognised wrappers. `prisma` as an
 * argument, inside quotes (`sh -c "prisma generate"`), or as the start of a
 * longer word (`prisma@7`, `prisma-erd`) is left alone.
 */
export function rewritePrismaBinary(script: string): string {
  const ends = commandsOf(script)
    .map((words) => prismaCommandWord(words, 0)?.end)
    .filter((end) => end !== undefined);
  return ends.reduceRight(
    (rewritten, end) => `${rewritten.slice(0, end)}7${rewritten.slice(end)}`,
    script,
  );
}

/**
 * Rewrites every `package.json` script that invokes the `prisma` binary to
 * invoke `prisma7`, except the scripts init itself adds, which keep the
 * Prisma 8 binary. Returns `null` when no script changes.
 */
export function rewritePrismaScripts(
  manifest: string,
  keepNames: readonly string[],
): { readonly content: string; readonly names: readonly string[] } | null {
  const parsed = blindCast<
    Record<string, unknown>,
    'JSON.parse returns unknown; package.json is a JSON object so its top level is a string-keyed record'
  >(JSON.parse(manifest));
  const scripts = parsed['scripts'];
  if (typeof scripts !== 'object' || scripts === null) {
    return null;
  }
  const kept = new Set(keepNames);
  const names: string[] = [];
  const next: Record<string, unknown> = {};
  for (const [name, command] of Object.entries(scripts)) {
    const rewritten =
      typeof command === 'string' && !kept.has(name) ? rewritePrismaBinary(command) : command;
    if (rewritten !== command) {
      names.push(name);
    }
    next[name] = rewritten;
  }
  if (names.length === 0) {
    return null;
  }
  parsed['scripts'] = next;
  const trailingNewline = manifest.endsWith('\n') ? '\n' : '';
  return { content: `${JSON.stringify(parsed, null, 2)}${trailingNewline}`, names };
}
