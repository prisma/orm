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

const PNPM_ERROR_CODE = /\bERR_PNPM_[A-Z0-9_]+\b/g;

/**
 * Whether pnpm's output names an error code that justifies the npm fallback. `init` reads it
 * from the output the package-manager capability returns on a failed install.
 */
export function isRecognisedPnpmResolutionError(output: string): boolean {
  return Array.from(output.matchAll(PNPM_ERROR_CODE), ([code]) => code).some((code) =>
    FALLBACK_PNPM_ERROR_CODES.has(code),
  );
}

export function isPnpmIgnoredBuildsError(stderr: string): boolean {
  if (!stderr) return false;
  return stderr.includes('ERR_PNPM_IGNORED_BUILDS');
}
