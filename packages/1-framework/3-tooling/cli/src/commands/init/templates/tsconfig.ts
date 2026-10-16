import {
  applyEdits,
  modify,
  type ParseError,
  parse as parseJsonc,
  printParseErrorCode,
} from 'jsonc-parser';

/**
 * Compiler options the scaffolded `prisma.config.ts` and `db.ts` need
 * to typecheck:
 *
 * - `module: 'preserve'` + `moduleResolution: 'bundler'` align with how
 *   modern bundlers (and `tsdown`) consume our facade packages.
 * - `resolveJsonModule` lets `db.ts` import `contract.json with { type:
 *   'json' }` — the runtime path the facades document (FR4).
 *
 * `types: ['node']` is FR2.2 territory and lives in
 * `REQUIRED_COMPILER_OPTIONS_TYPES` because TS only honours an _array_
 * here, and a string-keyed merge would clobber any user-specified entries.
 * Merge handling preserves any extra `types` the user added.
 */
export const REQUIRED_COMPILER_OPTIONS: Record<string, string | boolean> = {
  module: 'preserve',
  moduleResolution: 'bundler',
  resolveJsonModule: true,
};

/**
 * Types that must be present in `compilerOptions.types` for the scaffold
 * to typecheck. With `moduleResolution: 'bundler'`, TypeScript does not
 * implicitly include all `@types/*` packages — `process.env` only resolves
 * when `node` is in this array (or `types` is omitted, but then any other
 * type listed here would force the same behaviour). Listing `node`
 * explicitly is the documented escape hatch (FR2.2).
 */
export const REQUIRED_COMPILER_OPTIONS_TYPES: readonly string[] = ['node'];

const MODULE_COMPILER_OPTIONS: readonly string[] = ['module', 'moduleResolution'];

/**
 * The `module` values that go with each resolution mode the scaffold
 * already typechecks under, so a project that has picked one keeps its
 * own pair. `db.ts` spells its type import `./contract.js`, which
 * resolves to the emitted `contract.d.ts` under both.
 *
 * Node 18 and Node 20 projects resolve under `moduleResolution:
 * 'node16'` — TypeScript has no `node18` or `node20` resolution mode —
 * and under `'nodenext'` as well.
 *
 * Only whole pairs count: TypeScript rejects a mismatched one (TS5110,
 * TS5095), so a project carrying half of one still gets the required
 * defaults. So does one on `module: 'node16'`, which predates import
 * attributes — `db.ts` imports `contract.json with { type: 'json' }`,
 * which is TS2823 there.
 */
const SUPPORTED_MODULE_PAIRS: Readonly<Record<string, readonly string[]>> = {
  bundler: ['preserve', 'esnext'],
  node16: ['node18', 'node20'],
  nodenext: ['nodenext', 'node18', 'node20'],
};

export function defaultTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        ...REQUIRED_COMPILER_OPTIONS,
        types: [...REQUIRED_COMPILER_OPTIONS_TYPES],
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        outDir: 'dist',
      },
      include: ['**/*.ts'],
    },
    null,
    2,
  );
}

/**
 * Thrown by `mergeTsConfig` when the user's existing `tsconfig.json` is
 * not parseable as JSONC (TypeScript's actual configured dialect — see
 * FR6.1). Carries the raw parse errors so the caller can render an
 * actionable, location-aware message.
 *
 * `runInit` catches this exception during the precondition phase and
 * maps it to a `CliStructuredError(5011)` so the user's working tree
 * stays byte-identical when init bails (FR6.2 / NFR3).
 */
export class TsConfigParseError extends Error {
  readonly errors: readonly ParseError[];

  constructor(errors: readonly ParseError[]) {
    super(formatTsConfigParseErrors(errors));
    this.errors = errors;
    this.name = 'TsConfigParseError';
  }
}

function formatTsConfigParseErrors(errors: readonly ParseError[]): string {
  if (errors.length === 0) {
    return 'tsconfig.json is empty or not an object';
  }
  return errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`).join('; ');
}

/**
 * Merges the required compiler options into an existing `tsconfig.json`.
 *
 * Parsing is delegated to `jsonc-parser` so JSONC inputs (comments,
 * trailing commas) — TypeScript's real configuration dialect — survive
 * unchanged: edits are applied as text patches via `modify` /
 * `applyEdits`, preserving the user's formatting, key ordering, and
 * comments wherever the touched paths permit (FR6.1, AC "Hostile
 * inputs").
 *
 * Throws `TsConfigParseError` when the input is not parseable as JSONC.
 * The caller must catch this and surface a structured error before
 * writing any scaffold files (FR6.2 atomicity).
 *
 * A project already on a `SUPPORTED_MODULE_PAIRS` pair keeps its own
 * `module` / `moduleResolution`: rewriting a resolution mode the
 * scaffold typechecks under buys nothing, and the options a project
 * never set are still added.
 */
export function mergeTsConfig(existing: string): string {
  const { config } = parseTsConfigText(existing);

  // Match the indentation / line-ending style of the existing file so
  // the merged output diffs cleanly against it. `jsonc-parser` uses
  // these only when it has to insert a brand-new object node;
  // existing-key edits replace the value in place.
  const formattingOptions = {
    tabSize: detectIndent(existing),
    insertSpaces: true,
    eol: existing.includes('\r\n') ? '\r\n' : '\n',
  };

  const compilerOptions = config['compilerOptions'] as Record<string, unknown> | undefined;
  const keepModuleOptions = resolvesScaffoldImports(compilerOptions);

  let result = existing;
  for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
    if (keepModuleOptions && MODULE_COMPILER_OPTIONS.includes(key)) {
      continue;
    }
    const edits = modify(result, ['compilerOptions', key], value, { formattingOptions });
    result = applyEdits(result, edits);
  }

  const mergedTypes = mergeTypesArray(compilerOptions?.['types']);
  const typesEdits = modify(result, ['compilerOptions', 'types'], mergedTypes, {
    formattingOptions,
  });
  result = applyEdits(result, typesEdits);

  return result;
}

/**
 * Parses an existing `tsconfig.json` (JSONC) and returns the structured
 * config alongside any non-fatal parse warnings. Throws
 * `TsConfigParseError` if the input cannot be parsed at all or does
 * not resolve to a JSON object — both cases mean we cannot safely
 * apply edits.
 *
 * Exposed independently so callers (notably `runInit`'s precondition
 * gate) can validate the file *before* any scaffold file is written.
 */
export function parseTsConfigText(text: string): {
  readonly config: Record<string, unknown>;
} {
  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, {
    allowTrailingComma: true,
    disallowComments: false,
    allowEmptyContent: false,
  });

  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TsConfigParseError(errors);
  }
  if (errors.length > 0) {
    throw new TsConfigParseError(errors);
  }
  return { config: value as Record<string, unknown> };
}

function resolvesScaffoldImports(compilerOptions: Record<string, unknown> | undefined): boolean {
  const moduleResolution = compilerOptions?.['moduleResolution'];
  const moduleOption = compilerOptions?.['module'];
  if (typeof moduleResolution !== 'string' || typeof moduleOption !== 'string') {
    return false;
  }
  const resolution = moduleResolution.toLowerCase();
  if (!Object.hasOwn(SUPPORTED_MODULE_PAIRS, resolution)) {
    return false;
  }
  return SUPPORTED_MODULE_PAIRS[resolution]?.includes(moduleOption.toLowerCase()) ?? false;
}

function detectIndent(text: string): number {
  // Look at the first indented line. A 2-space indent (the TS default)
  // is by far the most common; we fall back to 2 when nothing useful
  // is detectable (e.g. a single-line tsconfig).
  const match = text.match(/^([ \t]+)\S/m);
  if (match === null) {
    return 2;
  }
  const indent = match[1] ?? '';
  if (indent.startsWith('\t')) {
    return 1;
  }
  return indent.length || 2;
}

/**
 * Merges `REQUIRED_COMPILER_OPTIONS_TYPES` into the user's existing
 * `compilerOptions.types` array. Preserves order and dedupes. If the
 * user has no `types` array (or has set it to a non-array), we replace
 * with the required minimum — overwriting a non-array `types` is the
 * correct fix because anything other than a string array is invalid TS
 * config.
 */
function mergeTypesArray(existing: unknown): readonly string[] {
  const result: string[] = [];
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (typeof item === 'string' && !result.includes(item)) {
        result.push(item);
      }
    }
  }
  for (const required of REQUIRED_COMPILER_OPTIONS_TYPES) {
    if (!result.includes(required)) {
      result.push(required);
    }
  }
  return result;
}
