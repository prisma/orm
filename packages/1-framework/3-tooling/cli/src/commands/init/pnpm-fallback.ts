/**
 * Recognised pnpm error signatures that justify a fallback to npm.
 *
 * These patterns indicate the published artifact itself is at fault
 * (a leaked `workspace:*` or `catalog:` specifier), not the user's
 * environment — pnpm is faithfully reporting "I cannot resolve this
 * registry version", and npm is willing to install it because npm
 * doesn't care about the protocol prefix when there's a fallback range.
 *
 * The predicate lives on its own so both shells' `init` share one list:
 * the commander command matches it against captured child stderr, the
 * engine command against the stderr the package-manager capability
 * returns on a failed install.
 */
export function isRecognisedPnpmResolutionError(stderr: string): boolean {
  if (!stderr) return false;
  return (
    stderr.includes('ERR_PNPM_WORKSPACE_PKG_NOT_FOUND') ||
    stderr.includes('ERR_PNPM_NO_MATCHING_VERSION') ||
    /No matching version found for .* in the catalog/i.test(stderr) ||
    /workspace:[^\s]+ is not a valid (version|spec)/i.test(stderr) ||
    /catalog:[^\s]* is not a valid (version|spec)/i.test(stderr)
  );
}

export function isPnpmIgnoredBuildsError(stderr: string): boolean {
  if (!stderr) return false;
  return stderr.includes('ERR_PNPM_IGNORED_BUILDS');
}
