import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'pathe';

/**
 * The user-level config file. Persists the telemetry flag and the
 * installation UUID. Under the opt-out model the flag stays `undefined`
 * until the user makes an explicit choice (default-on first run mints
 * only the id via {@link ensureInstallationId}), and an env-var opt-out
 * never mutates disk. Once the id exists it survives any
 * on → off → on cycle, keeping the same UUID (correct for MAU continuity).
 *
 * Readers tolerate unknown fields for forward compat; writers merge
 * partials into the existing object so unknown fields are preserved.
 */
export interface UserConfig {
  readonly enableTelemetry?: boolean;
  readonly installationId?: string;
  readonly [key: string]: unknown;
}

const APP_DIR = 'prisma-8';
const FILE_NAME = 'config.json';

/**
 * Resolves the user-level config directory:
 *   - Windows: `%APPDATA%\prisma-8\` (fallback: `%USERPROFILE%\AppData\Roaming\prisma-8\`).
 *   - Unix (incl. macOS): `$XDG_CONFIG_HOME/prisma-8/` if set, else
 *     `$HOME/.config/prisma-8/` per the XDG Base Directory Specification.
 *
 * The spec deliberately picks XDG over the macOS-native
 * `~/Library/Preferences/` convention so the path resolution is
 * test-overridable via `XDG_CONFIG_HOME` and matches the documented
 * behaviour on all *nix platforms. We intentionally do not use
 * `env-paths`: its macOS choice of `~/Library/Preferences` is for
 * OS-managed plist preferences, not arbitrary JSON files. Apple documents
 * that apps access that directory through system APIs such as
 * `NSUserDefaults`, while cross-platform CLI and developer tools conventionally
 * use `~/.config` on macOS too:
 * https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/FileSystemProgrammingGuide/MacOSXDirectories/MacOSXDirectories.html
 */
function configDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'];
    if (appData !== undefined && appData.length > 0) {
      return join(appData, APP_DIR);
    }
    return join(homedir(), 'AppData', 'Roaming', APP_DIR);
  }
  const xdg = process.env['XDG_CONFIG_HOME'];
  if (xdg !== undefined && xdg.length > 0) {
    return join(xdg, APP_DIR);
  }
  return join(homedir(), '.config', APP_DIR);
}

/**
 * Path to the user-level config file. Resolved per call so test
 * harnesses can mutate `$XDG_CONFIG_HOME` between cases.
 */
export function userConfigPath(): string {
  return join(configDir(), FILE_NAME);
}

/**
 * Reads the user-level config. File-missing, unreadable, or malformed →
 * `{}` (the absence of consent is the same answer in every error mode).
 * Unknown fields from a future client are passed through verbatim.
 */
export function readUserConfig(): UserConfig {
  const path = userConfigPath();
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as UserConfig;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Merges `partial` into the current config and writes the result
 * atomically (temp file + rename) so a crash mid-write never leaves a
 * half-baked file readable on disk. Unknown fields already on disk are
 * preserved.
 *
 * When `partial.enableTelemetry === true` and no `installationId` is
 * stored yet, generates a v4 random UUID and persists both fields in
 * the same write. An existing `installationId` is never rotated. This is
 * the *explicit-consent* mint path: a `false` answer
 * (`writeUserConfig({ enableTelemetry: false })`) writes no id, and a bare
 * `writeUserConfig({ installationId })` mints nothing extra. The default-on
 * first-send path mints its id separately via {@link ensureInstallationId},
 * which records no consent answer.
 */
export function writeUserConfig(partial: Partial<UserConfig>): void {
  const current = readUserConfig();
  const merged: Record<string, unknown> = { ...current, ...partial };
  if (partial.enableTelemetry === true && merged['installationId'] === undefined) {
    merged['installationId'] = randomUUID();
  }
  const path = userConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${path}.${process.pid}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf-8');
  renameSync(tmpPath, path);
}

/**
 * Returns the stored `installationId`, minting and persisting a fresh v4
 * UUID when none exists yet. Crucially, this persists *only* the id —
 * `enableTelemetry` is left untouched (stays `undefined` on a default-on
 * first run), so the interactive `init` consent prompt is not wrongly
 * suppressed and no explicit consent the user never gave is recorded.
 *
 * Used by the default-on first-run fire path: the gate has already
 * resolved enabled, so this only ever runs when telemetry is on.
 */
export function ensureInstallationId(): string {
  const existing = readUserConfig().installationId;
  if (typeof existing === 'string' && existing.length > 0) {
    return existing;
  }
  const installationId = randomUUID();
  writeUserConfig({ installationId });
  return installationId;
}
