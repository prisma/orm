import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'pathe';

/**
 * Catalog entry detected in a `pnpm-workspace.yaml` that overrides one of
 * the packages `init` installs. The `version` is the raw value as written
 * in the workspace file (no normalisation), so the warning surfaces the
 * exact text the user can search for if they want to find the override.
 */
export interface PnpmCatalogOverride {
  readonly name: string;
  readonly version: string;
}

/**
 * Result of scanning for a pnpm workspace catalog that overrides any of
 * the packages `init` is about to install. Returns `null` when no
 * `pnpm-workspace.yaml` is found in `baseDir` or any ancestor; an empty
 * `entries` array means a workspace exists but contains none of our
 * packages.
 */
export interface PnpmCatalogScanResult {
  /** Absolute path of the `pnpm-workspace.yaml` that was consulted. */
  readonly workspaceFile: string;
  readonly entries: readonly PnpmCatalogOverride[];
}

/**
 * Walks up from `baseDir` looking for `pnpm-workspace.yaml`, then scans
 * its top-level `catalog:` block for entries that match any of `packages`.
 *
 * Implements FR7.3 / Spec Decision 8 (honour-and-warn): when `init` runs
 * inside a pnpm workspace whose catalog overrides one of the packages it
 * installs, surface a structured warning so the user knows the catalog
 * version (not the published `latest`) is what ended up in their
 * `node_modules`. pnpm itself does this silently; the warning closes the
 * "looks fine, must be wrong version six months later" gap.
 *
 * Notes / scope:
 *
 * - We only inspect the unnamed top-level `catalog:` block. pnpm also
 *   supports `catalogs:` (plural — *named* catalogs referenced via
 *   `catalog:foo` specifiers); those don't apply to the vanilla
 *   `pnpm add` invocations `init` runs, so we skip them.
 * - We don't validate YAML syntax exhaustively. The file format pnpm
 *   ships is line-oriented and well-known; a minimal regex is more
 *   robust than depending on a YAML parser for one warning.
 * - We don't compare against the registry's `latest` — pnpm uses the
 *   catalog version regardless, so the warning fires whenever a match
 *   exists. The user-facing copy explains how to opt out.
 */
export function detectPnpmCatalogOverrides(
  baseDir: string,
  packages: readonly string[],
): PnpmCatalogScanResult | null {
  const workspaceFile = findNearestPnpmWorkspaceFile(baseDir);
  if (workspaceFile === null) {
    return null;
  }

  const contents = readFileSync(workspaceFile, 'utf-8');
  const catalog = extractCatalogBlock(contents);
  if (catalog === null) {
    return { workspaceFile, entries: [] };
  }

  const wanted = new Set(packages);
  const entries: PnpmCatalogOverride[] = [];
  for (const [name, version] of catalog) {
    if (wanted.has(name)) {
      entries.push({ name, version });
    }
  }
  return { workspaceFile, entries };
}

function findNearestPnpmWorkspaceFile(baseDir: string): string | null {
  let dir = baseDir;
  let prev = '';
  while (dir !== prev) {
    const candidate = join(dir, 'pnpm-workspace.yaml');
    if (existsSync(candidate)) {
      return candidate;
    }
    prev = dir;
    dir = dirname(dir);
  }
  return null;
}

/**
 * Returns the entries inside the top-level `catalog:` block as `[name, version]`
 * pairs in document order, or `null` when no `catalog:` block exists.
 *
 * The parser is intentionally minimal: it reads line-by-line, locates the
 * top-level `catalog:` line (no leading whitespace), then collects every
 * subsequent indented line of the form `<key>: <value>` until the next
 * top-level key (or end of file). Quotes around `<key>` and `<value>`
 * are stripped; comments (`#…`) are ignored.
 */
function extractCatalogBlock(contents: string): Array<[string, string]> | null {
  const lines = contents.split(/\r?\n/);
  const startIdx = lines.findIndex((line) => /^catalog\s*:\s*$/.test(line));
  if (startIdx === -1) {
    return null;
  }

  const entries: Array<[string, string]> = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    if (raw.trim() === '' || /^\s*#/.test(raw)) {
      continue;
    }
    if (!/^\s/.test(raw)) {
      // Hit the next top-level key — catalog block ended.
      break;
    }
    const match = raw.match(/^\s+(?:'([^']+)'|"([^"]+)"|([^:\s'"]+))\s*:\s*(.*?)\s*(?:#.*)?$/);
    if (!match) {
      continue;
    }
    const name = match[1] ?? match[2] ?? match[3];
    if (name === undefined) continue;
    const rawValue = match[4] ?? '';
    const version = stripQuotes(rawValue.trim());
    if (version === '') continue;
    entries.push([name, version]);
  }
  return entries;
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
