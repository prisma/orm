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

const RUNNER = String.raw`(?:pnpm|npx|yarn|bunx?)(?:\s+(?:exec|dlx|x))?`;

const ENV_ASSIGNMENTS = String.raw`(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*`;

/**
 * `prisma` at command position: the start of the script, after a shell
 * operator, after `--`, or after a package-manager runner, with any run of
 * `NAME=value` assignments in between. Followed by whitespace or the end, so
 * `prisma7`, `prisma@7`, and `prisma-erd` are left alone.
 */
const PRISMA_AT_COMMAND_POSITION = new RegExp(
  String.raw`(^|&&|\|\||;|\||--|\b${RUNNER})(\s*${ENV_ASSIGNMENTS})prisma(?=\s|$)`,
  'g',
);

export function rewritePrismaBinary(script: string): string {
  return script.replace(PRISMA_AT_COMMAND_POSITION, '$1$2prisma7');
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
