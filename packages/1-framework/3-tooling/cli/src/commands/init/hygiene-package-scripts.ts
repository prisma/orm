import { blindCast } from '@internal/utils/casts';

/**
 * The package.json `scripts` entries `init` adds idempotently (FR3.5).
 * The script *name* mirrors the CLI subcommand path (`contract:emit` →
 * `prisma-cli contract emit`) so the script is greppable: a user
 * encountering `npm run contract:emit` in CI logs can navigate
 * straight to the equivalent CLI invocation.
 *
 * No watch-mode entry is included (Spec Decision 9) — file-watching is
 * the build tool's job (Vite plugin, `tsc --watch`, etc.).
 */
export interface RequiredScript {
  readonly name: string;
  readonly command: string;
}

export const REQUIRED_SCRIPTS: readonly RequiredScript[] = [
  { name: 'contract:emit', command: 'prisma-cli contract emit' },
];

export interface PackageScriptsMergeResult {
  /**
   * The new package.json content. `null` when no changes are required
   * (every required script is already present with the correct
   * command).
   */
  readonly content: string | null;
  /**
   * Structured warnings raised when an existing script of the same
   * name maps to a different command. Each warning names the script,
   * the existing command, and the command we wanted to write — the
   * user can decide whether to keep their override or update it.
   */
  readonly warnings: readonly string[];
}

/**
 * Idempotent `package.json#scripts` merge with collision detection
 * (FR3.5 / FR9.3):
 *
 * - If a required script is **missing**, append it.
 * - If a required script is **already present and identical**, leave
 *   the file alone (idempotency).
 * - If a required script is **present but maps to a different command**,
 *   skip the write for that script and surface a structured warning.
 *   The user's override is sacred — `init` should never silently
 *   overwrite a custom build pipeline.
 *
 * Preserves the existing key order (so a user who has alphabetised
 * their scripts does not see them reshuffled) and appends new entries
 * at the end.
 *
 * The `package.json` is parsed and re-stringified through `JSON` —
 * comments are not preserved (package.json does not support them per
 * spec). Trailing newline matches the original input's trailing
 * newline behaviour.
 */
export function mergePackageScripts(
  existing: string,
  required: readonly RequiredScript[] = REQUIRED_SCRIPTS,
): PackageScriptsMergeResult {
  const parsed = blindCast<
    Record<string, unknown>,
    'JSON.parse returns `unknown`; package.json is a JSON object so its top level is a string-keyed record'
  >(JSON.parse(existing));
  const scripts: Record<string, string> =
    typeof parsed['scripts'] === 'object' && parsed['scripts'] !== null
      ? {
          ...blindCast<
            Record<string, string>,
            'guarded above: parsed.scripts is a non-null object; package.json `scripts` values are command strings'
          >(parsed['scripts']),
        }
      : {};

  const warnings: string[] = [];
  let mutated = false;

  for (const { name, command } of required) {
    const existingValue = scripts[name];
    if (existingValue === undefined) {
      scripts[name] = command;
      mutated = true;
      continue;
    }
    if (existingValue !== command) {
      warnings.push(
        `package.json already has a "${name}" script with a different command — keeping yours.\n  existing: ${existingValue}\n  expected: ${command}\nIf you want the default, remove your "${name}" script and re-run \`orm init\`.`,
      );
    }
  }

  if (!mutated) {
    return { content: null, warnings };
  }

  parsed['scripts'] = scripts;
  const trailingNewline = existing.endsWith('\n') ? '\n' : '';
  return { content: `${JSON.stringify(parsed, null, 2)}${trailingNewline}`, warnings };
}

export interface EsmModuleTypeResult {
  /**
   * The new package.json content. `null` when no change is required —
   * either `"type": "module"` is already set, or the user has explicitly
   * opted into a different module type (in which case `warning` is set).
   */
  readonly content: string | null;
  /**
   * Structured warning raised when `"type"` is already set to a value
   * other than `"module"`. The user's explicit choice is preserved, but
   * the scaffolded `db.ts` uses the ESM-only `with { type: 'json' }`
   * import attribute and will not load under CJS resolution.
   */
  readonly warning: string | null;
}

/**
 * Idempotently sets `"type": "module"` on a `package.json` so the
 * scaffolded `prisma/db.ts` — which uses the ESM-only `with { type: 'json' }`
 * import attribute — loads as ES module under Node's loader (TML-2494).
 *
 * Without this field Node either:
 *
 * - emits `MODULE_TYPELESS_PACKAGE_JSON` and reparses the file as ESM
 *   with a perf penalty (Node 22+ with `--experimental-strip-types`), or
 * - hard-fails with `ERR_*` because the CJS loader cannot parse the
 *   import-attribute syntax (older Node, or any tool that doesn't
 *   reparse).
 *
 * Behaviour:
 *
 * - **Field missing** → set to `"module"`. New entry is inserted right
 *   after `"name"` (when present) so the diff lands in a conventional
 *   spot for human review; falls through to the natural append position
 *   otherwise.
 * - **Field already `"module"`** → no-op (idempotent).
 * - **Field set to anything else** (e.g. `"commonjs"`) → leave it alone
 *   and surface a structured warning. The user explicitly opted out of
 *   ESM and we don't silently overwrite that.
 */
export function ensureEsmModuleType(existing: string): EsmModuleTypeResult {
  const parsed = blindCast<
    Record<string, unknown>,
    'JSON.parse returns `unknown`; package.json is a JSON object so its top level is a string-keyed record'
  >(JSON.parse(existing));
  const currentType = parsed['type'];

  if (currentType === 'module') {
    return { content: null, warning: null };
  }

  if (typeof currentType === 'string' && currentType !== 'module') {
    return {
      content: null,
      warning: `package.json declares "type": "${currentType}" — keeping yours, but the scaffolded prisma/db.ts uses an ESM-only import attribute (\`with { type: 'json' }\`) and will not load under that module type.\nIf you want the default, set "type": "module" in package.json.`,
    };
  }

  const next: Record<string, unknown> = {};
  let inserted = false;
  for (const [key, value] of Object.entries(parsed)) {
    // A non-string `type` slipped past the early-return guards above
    // (those only fire for `'module'` and other strings). Skip it so the
    // normalised `'module'` we inject below cannot be overwritten when
    // `type` appears after `name` in key order.
    if (key === 'type') continue;
    next[key] = value;
    if (!inserted && key === 'name') {
      next['type'] = 'module';
      inserted = true;
    }
  }
  if (!inserted) {
    next['type'] = 'module';
  }

  const trailingNewline = existing.endsWith('\n') ? '\n' : '';
  return { content: `${JSON.stringify(next, null, 2)}${trailingNewline}`, warning: null };
}
