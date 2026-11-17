/**
 * pnpm error codes that mean the published artifact itself is at fault (a leaked `workspace:`
 * or `catalog:` specifier), not the user's environment. npm installs such an artifact, so init
 * falls back to it. Pinned against pnpm 10.27: a leaked `workspace:` specifier reports
 * `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`, a leaked `catalog:` one
 * `ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`. `ERR_PNPM_NO_MATCHING_VERSION` is left out: pnpm
 * reports it for a version the registry does not have, which npm cannot install either.
 */
const FALLBACK_PNPM_ERROR_CODES: ReadonlySet<string> = new Set([
  'ERR_PNPM_WORKSPACE_PKG_NOT_FOUND',
  'ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER',
]);

/**
 * pnpm 11 and later fail an install that reached a dependency build script nobody approved, after
 * the packages are already added and linked. pnpm 12 reports it on stderr, pnpm 11 on stdout.
 */
const IGNORED_BUILDS_PNPM_ERROR_CODE = 'ERR_PNPM_IGNORED_BUILDS';

const PNPM_ERROR_CODE = /\bERR_PNPM_[A-Z0-9_]+\b/g;

function pnpmErrorCodes(output: string): readonly string[] {
  return Array.from(output.matchAll(PNPM_ERROR_CODE), ([code]) => code);
}

/**
 * Whether pnpm's output names an error code that justifies the npm fallback. `init` reads it
 * from the output the package-manager capability returns on a failed install.
 */
export function isRecognisedPnpmResolutionError(output: string): boolean {
  return pnpmErrorCodes(output).some((code) => FALLBACK_PNPM_ERROR_CODES.has(code));
}

/** Whether the only pnpm error code in the output is the one for skipped, unapproved build scripts. */
export function isOnlyPnpmIgnoredBuildsError(output: string): boolean {
  const codes = new Set(pnpmErrorCodes(output));
  return codes.size === 1 && codes.has(IGNORED_BUILDS_PNPM_ERROR_CODE);
}
