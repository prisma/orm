import type { Result } from '@internal/utils/result';
import { notOk, ok } from '@internal/utils/result';
import { EMPTY_CONTRACT_HASH } from '../constants';
import { validateRefName } from '../refs';
import type {
  ContractRef,
  ContractRefProvenance,
  RefResolutionContext,
  RefResolutionError,
} from './types';
import { findEdgeByDirName, isFullHash, isHexPrefix } from './types';

/**
 * Resolve a user-supplied string to a contract hash using the unified
 * contract-reference grammar.
 *
 * Accepted forms:
 * - `@contract` — the on-disk working contract hash (offline; requires
 *   `ctx.contractHash` to be set)
 * - `@db` — the live database marker (connection-required); callers MUST
 *   check `result.value.provenance.kind === 'reserved-db'` and resolve the
 *   actual hash via `readAllMarkers()` before using `result.value.hash`
 * - `@empty` — the empty contract (offline; resolves to
 *   `EMPTY_CONTRACT_HASH`, the origin with no prior storage state)
 * - Full storage hash (64 hex chars or `empty`)
 * - Hex prefix (6+ hex chars, must uniquely identify one contract)
 * - Ref name (looked up in the refs index)
 * - Migration directory name (resolves to the migration's `to`-contract)
 * - `<dir>^` (resolves to the migration's `from`-contract)
 */
export function parseContractRef(
  input: string,
  ctx: RefResolutionContext,
): Result<ContractRef, RefResolutionError> {
  if (!input) {
    return notOk({ kind: 'invalid-format', input, reason: 'Reference cannot be empty' });
  }

  if (input === '@contract') {
    if (ctx.contractHash === undefined) {
      return notOk({
        kind: 'not-found',
        input,
        grammar: 'contract',
      });
    }
    return ok({ hash: ctx.contractHash, provenance: { kind: 'reserved-contract' } });
  }

  if (input === '@db') {
    // The live DB marker is not available offline. Return a sentinel result with
    // a `reserved-db` provenance; callers must resolve the actual hash via
    // `readAllMarkers()`. The `hash` placeholder is intentionally empty — it
    // must NOT be used directly. This is enforced by convention; callers
    // should check `provenance.kind` before using the hash.
    return ok({ hash: '', provenance: { kind: 'reserved-db' } });
  }

  if (input === '@empty') {
    return ok({ hash: EMPTY_CONTRACT_HASH, provenance: { kind: 'reserved-empty' } });
  }

  if (isFullHash(input)) {
    if (ctx.graph.nodes.has(input)) {
      return ok({ hash: input, provenance: { kind: 'hash', input } });
    }
    return notOk({ kind: 'not-found', input, grammar: 'contract' });
  }

  if (input.endsWith('^')) {
    const dirName = input.slice(0, -1);
    if (!dirName) {
      return notOk({ kind: 'invalid-format', input, reason: 'Missing directory name before ^' });
    }
    const edge = findEdgeByDirName(ctx.graph, dirName);
    if (edge) {
      return ok({ hash: edge.from, provenance: { kind: 'migration-from', dirName } });
    }
    return notOk({ kind: 'not-found', input, grammar: 'contract' });
  }

  type Candidate = { hash: string; provenance: ContractRefProvenance; label: string };
  const candidates: Candidate[] = [];

  if (validateRefName(input) && Object.hasOwn(ctx.refs, input)) {
    const ref = ctx.refs[input];
    if (ref) {
      candidates.push({
        hash: ref.hash,
        provenance: { kind: 'ref', refName: input },
        label: `ref "${input}"`,
      });
    }
  }

  const edge = findEdgeByDirName(ctx.graph, input);
  if (edge) {
    candidates.push({
      hash: edge.to,
      provenance: { kind: 'migration-to', dirName: input },
      label: `migration directory "${input}"`,
    });
  }

  if (isHexPrefix(input)) {
    const matches = [...ctx.graph.nodes].filter((n) => n.startsWith(input));
    const [firstMatch] = matches;
    if (matches.length === 1 && firstMatch !== undefined) {
      candidates.push({
        hash: firstMatch,
        provenance: { kind: 'hash', input },
        label: `hash prefix "${input}"`,
      });
    } else if (matches.length > 1) {
      return notOk({ kind: 'ambiguous', input, candidates: matches, grammar: 'contract' });
    }
  }

  const [firstCandidate] = candidates;
  if (candidates.length === 1 && firstCandidate !== undefined) {
    return ok({ hash: firstCandidate.hash, provenance: firstCandidate.provenance });
  }

  if (candidates.length > 1) {
    return notOk({
      kind: 'ambiguous',
      input,
      candidates: candidates.map((c) => c.label),
      grammar: 'contract',
    });
  }

  return notOk({ kind: 'not-found', input, grammar: 'contract' });
}
