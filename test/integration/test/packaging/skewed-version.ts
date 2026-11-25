import { releaseOfRootVersion } from '@internal/publish-surface/release-plan';

/**
 * A version of one of our packages that every range in force for `rootVersion` refuses, for a test
 * that packs one package out of step with the others. On the release candidates every package names
 * the others at one exact `8.0.0-rc.N`, so the next counter is refused. On the levels line a later
 * patch or minor can satisfy a tilde or an extension's caret, so the skew is to the next major.
 */
export function versionOutsideTheRelease(rootVersion: string): string {
  const root = releaseOfRootVersion(rootVersion);
  return root.line === 'release-candidates'
    ? `${root.release.major}.${root.release.minor}.0-rc.${(root.rcCounter ?? 0) + 1}`
    : `${root.release.major + 1}.0.0`;
}
