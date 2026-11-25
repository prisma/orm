/**
 * Pure helpers for `publish-packages.mjs`, factored out so the
 * exit-code / output classification can be unit-tested without spawning
 * `pnpm publish` subprocesses.
 */

import {
  hasOwnVersion,
  parseVersion,
} from '../packages/0-shared/publish-surface/src/release-plan.ts';
import { numberingOf, planWorkspace, releaseOfRootVersion } from './release-plan-workspace.ts';

/**
 * npm's error wording when republishing a version number that already
 * exists on the registry. Surfaces both for "version is currently
 * published" *and* for "version was published-then-unpublished" — npm
 * permanently blocks the version number once it has ever been on the
 * registry under that name.
 *
 * We pattern-match on the human-readable message because the npm CLI
 * does not consistently surface a stable error code for this case in
 * the captured output of `pnpm publish` (no `npm error code
 * EPUBLISHCONFLICT` line is emitted on every npm version).
 */
const REPUBLISH_BLOCKED_MESSAGE = /You cannot publish over the previously published versions/;

/**
 * Sigstore transparency-log conflict during a provenance publish
 * (`TLOG_CREATE_ENTRY_ERROR`, HTTP 409 "an equivalent entry already
 * exists"). This is NOT a success: the log has the entry but the
 * version may never have reached the registry (observed live — the
 * 409 fired and the version was absent afterwards). It is a transient
 * race worth one retry; on the retry the registry either accepts the
 * publish or answers with the republish-blocked message above, and
 * that result is the truth.
 */
const TLOG_CONFLICT_MESSAGE = /TLOG_CREATE_ENTRY_ERROR|creating tlog entry - \(409\)/;

/**
 * Decide whether a `pnpm publish` invocation should count as a success.
 *
 * A non-zero exit with npm's "cannot publish over previously published
 * versions" message is treated as a no-op success: the version is
 * already on the registry under the expected name, so the *outcome* the
 * caller wanted (this version exists on npm) holds. This makes the
 * batch publish idempotent and lets a re-run after a partial failure
 * complete cleanly — the workflow's documented recovery path.
 *
 * If the dist-tag for the package needs adjusting after a republish
 * (npm does not touch dist-tags when it rejects a publish), that is a
 * separate concern handled out-of-band by the operator. This helper
 * intentionally does not infer it.
 */
export function classifyPublishResult({ code, output }) {
  if (code === 0) {
    return { ok: true, alreadyPublished: false, retryable: false };
  }
  if (REPUBLISH_BLOCKED_MESSAGE.test(output)) {
    return { ok: true, alreadyPublished: true, retryable: false };
  }
  if (TLOG_CONFLICT_MESSAGE.test(output)) {
    return { ok: false, alreadyPublished: false, retryable: true };
  }
  return { ok: false, alreadyPublished: false, retryable: false };
}

/**
 * The dist-tag one package is published under. A `latest` publish is a
 * release, and each package goes under the tag the release plan gives it:
 * on the release candidates that is `latest` for every package, and on the
 * levels line a package below GA that has ever been GA goes under its
 * level's name. Any other tag the workflow passes (`dev`, `beta`, a pull
 * request's tag) applies to every package as before.
 */
export function publishTagFor(passedTag, plannedTag) {
  if (passedTag !== 'latest') return passedTag;
  if (plannedTag === undefined) {
    throw new Error('a latest publish needs the release plan to give the package a tag');
  }
  return plannedTag;
}

/**
 * Whether a package has ever had a GA release, in any major version: a
 * plain `X.Y.Z` with a major of 1 or more is among its published versions.
 * A `0.x` version is Semantic Versioning's initial development, and the
 * `0.x` minors these packages had before the release candidates were not GA.
 */
export function wasEverGa(publishedVersions) {
  return publishedVersions.some((version) => {
    let parsed;
    try {
      parsed = parseVersion(version);
    } catch {
      return false;
    }
    return parsed.major >= 1 && parsed.level === undefined && parsed.dev === undefined;
  });
}

/**
 * Each published package's tag in the release plan for the root version.
 * On the levels line a package below GA that has ever had a GA release goes
 * under its level's name, which its published versions tell; the release
 * candidates read nothing from the registry. `publishedVersions` reads one
 * package's versions from the registry.
 */
export function releaseTagsFor({ rootDir, rootVersion, names, publishedVersions }) {
  const { line } = releaseOfRootVersion(rootVersion);
  const everGa = new Set(
    line === 'levels'
      ? names.filter((name) => numberingOf(name) !== 'ga' && wasEverGa(publishedVersions(name)))
      : [],
  );
  const plan = planWorkspace(rootDir, rootVersion, everGa);
  return new Map(Object.entries(plan).map(([name, planned]) => [name, planned.tag]));
}

/**
 * The packages with their own version whose version is already on the
 * registry. Such a package keeps its version until it gets a fix, so at most
 * releases there is nothing new of it to publish; it is skipped and reported,
 * not published and refused. On the release candidates every version is new,
 * and nothing is read from the registry.
 */
export function ownVersionsAlreadyPublished({ rootVersion, packages, publishedVersions }) {
  if (releaseOfRootVersion(rootVersion).line === 'release-candidates') return [];
  return packages
    .filter(({ name }) => hasOwnVersion(numberingOf(name)))
    .filter(({ name, version }) => publishedVersions(name).includes(version))
    .map(({ name }) => name);
}
