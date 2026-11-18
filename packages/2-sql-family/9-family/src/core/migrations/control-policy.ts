import {
  type Contract,
  type ControlPolicy,
  governingControlPolicy,
} from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';

/**
 * The target object a control policy governs for a single planner call,
 * resolved from the target's own IR. `undefined` means the call's target
 * object could not be positively established — a fail-closed signal: any
 * policy stricter than `managed` drops such a call rather than emitting it.
 *
 * The object identity is a generic storage coordinate — `(entityKind,
 * entityName)`, absent for a whole-namespace subject — never a target-specific
 * `table`/`typeName` field. The family reasons about the coordinate for policy
 * and deduplication; the target owns any vocabulary (table vs enum) when it
 * renders a suppression.
 */
export interface ControlPolicySubject {
  readonly namespaceId: string;
  readonly entityKind?: string;
  readonly entityName?: string;
  readonly column?: string;
  /**
   * Names the RLS policy when the suppressed thing is a policy-level unit
   * on the subject's table (mirrors `column`) — the report must say which
   * policy, not just which table.
   */
  readonly rlsPolicy?: string;
  readonly explicitNodeControlPolicy?: ControlPolicy;
  /**
   * Whether the call creates a whole, previously-absent top-level storage
   * object (e.g. a table or an enum/type), as opposed to modifying an
   * existing object. This is the only thing `tolerated` permits: it is a
   * create-if-absent policy, so an op that touches an existing object — add
   * column, add index/constraint, alter, drop — is never allowed under it.
   */
  readonly createsNewObject: boolean;
}

/**
 * The structured record a control-policy partition emits for one suppressed
 * subject or call. It carries only raw data — no strings, no vocabulary — so
 * the consumer (the target) renders the user-facing message itself:
 *
 * - `subject` — the suppressed subject (its coordinate + namespace), or
 *   `undefined` when the subject could not be resolved (fail-closed).
 * - `policy` — the effective control policy that caused the suppression.
 * - `factoryName` — the resolved creation factory name if the suppressed thing
 *   was a whole-object creation (e.g. `createTable`), else `undefined`. The
 *   family never invents a verb for a modification that produced no call.
 * - `createsNewObject` — whether the suppressed thing was object creation.
 */
export interface SuppressionRecord {
  readonly subject: ControlPolicySubject | undefined;
  readonly policy: ControlPolicy;
  readonly factoryName: string | undefined;
  readonly createsNewObject: boolean;
}

/**
 * Whether a call is allowed to emit under a given control policy.
 *
 * - `managed` — full lifecycle, every op allowed.
 * - `tolerated` — create-if-absent only: allowed iff the call creates a whole
 *   new top-level object (and its subject was positively resolved). Anything
 *   that modifies an existing object, and anything whose subject could not be
 *   resolved, is suppressed.
 * - `external` / `observed` — no DDL at all.
 */
function callAllowedUnderControlPolicy(
  policy: ControlPolicy,
  subject: ControlPolicySubject | undefined,
): boolean {
  switch (policy) {
    case 'managed':
      return true;
    case 'tolerated':
      return subject?.createsNewObject === true;
    case 'external':
    case 'observed':
      return false;
  }
}

/**
 * Partition the calls produced for a single set of subjects into those the
 * effective control policy permits (`kept`) and a list of
 * {@link SuppressionRecord}s describing the suppressed calls.
 *
 * **Prefer {@link partitionIssuesByControlPolicy}** for the schema-issue
 * pipeline: it filters subjects out of the planner's *input* so the planner
 * never has to reason about un-modeled state on `external`/`observed`
 * subjects. This call-level helper remains for paths that bypass the issue
 * pipeline — currently the codec-emitted field-event ops, which originate
 * from declared contract fields rather than from introspected schema state
 * and therefore cannot trip the diff engine.
 */
export function partitionCallsByControlPolicy<TCall>(options: {
  readonly calls: readonly TCall[];
  readonly contract: Contract<SqlStorage>;
  readonly resolveControlPolicySubject: (call: TCall) => ControlPolicySubject | undefined;
  readonly resolveFactoryName: (call: TCall) => string;
}): {
  readonly kept: readonly TCall[];
  readonly suppressions: readonly SuppressionRecord[];
} {
  const defaultControlPolicy = options.contract.defaultControlPolicy;
  const kept: TCall[] = [];
  const suppressions: SuppressionRecord[] = [];

  for (const call of options.calls) {
    const subject = options.resolveControlPolicySubject(call);
    const policy = governingControlPolicy(subject, defaultControlPolicy);
    if (callAllowedUnderControlPolicy(policy, subject)) {
      kept.push(call);
    } else {
      suppressions.push({
        subject,
        policy,
        factoryName: options.resolveFactoryName(call),
        createsNewObject: subject?.createsNewObject ?? false,
      });
    }
  }

  return Object.freeze({
    kept: Object.freeze(kept),
    suppressions: Object.freeze(suppressions),
  });
}

/**
 * Partition a list of schema-issue-shaped inputs by the effective control
 * policy of each issue's subject *before* the planner is invoked.
 *
 * `plannable` is the list of issues whose subject's effective policy permits
 * the planner to act on them (`managed`, or `tolerated` for whole-object
 * creation issues only). Issues for `external`/`observed` subjects, and
 * non-creation issues for `tolerated` subjects, are dropped from the planner's
 * input entirely — they never enter introspection-driven planning, never feed
 * the diff engine, and never produce DDL calls that would have to be
 * post-filtered. This sidesteps a class of failure where the diff engine
 * cannot reason about the live shape of a subject the user marked as
 * out-of-scope (`external`).
 *
 * `suppressions` is one {@link SuppressionRecord} per suppressed subject (not
 * per suppressed issue). Its `factoryName` is the creation factory name when any
 * of the subject's issues is whole-object creation (e.g. `createTable`), else
 * `undefined` — the family never invents a modification verb for an op that
 * produced no call; the target renders the message.
 *
 * Unresolved-subject issues (`resolveControlPolicySubject` returns
 * `undefined`) emit one record each; they cannot be deduplicated because they
 * carry no subject coordinate.
 */
export function partitionIssuesByControlPolicy<TIssue>(options: {
  readonly issues: readonly TIssue[];
  readonly contract: Contract<SqlStorage>;
  /**
   * Resolve the subject targeted by this issue (or `undefined` to fail-closed:
   * any policy stricter than `managed` drops the issue).
   */
  readonly resolveControlPolicySubject: (issue: TIssue) => ControlPolicySubject | undefined;
  /**
   * Resolve a creation factoryName for this issue if it represents the
   * absence of the whole top-level object (e.g. `'createTable'` for a
   * missing-table issue). When the issue describes a modification to an
   * existing object, return `undefined`. Both decisions feed off this signal:
   *
   * 1. Under `tolerated`, only issues whose `resolveCreationFactoryName`
   *    returns a value flow into the planner (create-if-absent).
   * 2. A suppressed subject's record carries the resolved creation factoryName
   *    when it has at least one creation-flavoured issue, else `undefined`.
   */
  readonly resolveCreationFactoryName: (issue: TIssue) => string | undefined;
}): {
  readonly plannable: readonly TIssue[];
  readonly suppressions: readonly SuppressionRecord[];
} {
  const defaultControlPolicy = options.contract.defaultControlPolicy;

  const plannable: TIssue[] = [];
  // Resolved-subject suppressions are deduplicated by subject key so we emit
  // one record per suppressed subject, not one per suppressed issue.
  // `creationFactoryName` upgrades from `undefined` to a concrete creation
  // name the first time we see a creation-flavoured issue for the subject.
  const suppressedSubjects = new Map<
    string,
    {
      readonly subject: ControlPolicySubject;
      readonly policy: ControlPolicy;
      creationFactoryName?: string;
    }
  >();
  const unresolvedSuppressions: SuppressionRecord[] = [];

  for (const issue of options.issues) {
    const subject = options.resolveControlPolicySubject(issue);
    const policy = governingControlPolicy(subject, defaultControlPolicy);
    const creationFactoryName = options.resolveCreationFactoryName(issue);

    if (policy === 'managed') {
      plannable.push(issue);
      continue;
    }
    if (
      policy === 'tolerated' &&
      subject !== undefined &&
      creationFactoryName !== undefined &&
      subject.createsNewObject
    ) {
      plannable.push(issue);
      continue;
    }

    if (subject === undefined) {
      unresolvedSuppressions.push({
        subject: undefined,
        policy,
        factoryName: creationFactoryName,
        createsNewObject: false,
      });
      continue;
    }

    const key = subjectKey(subject);
    const existing = suppressedSubjects.get(key);
    if (existing) {
      if (existing.creationFactoryName === undefined && creationFactoryName !== undefined) {
        existing.creationFactoryName = creationFactoryName;
      }
    } else {
      suppressedSubjects.set(key, {
        subject,
        policy,
        ...ifDefined('creationFactoryName', creationFactoryName),
      });
    }
  }

  const suppressions: SuppressionRecord[] = [...unresolvedSuppressions];
  for (const entry of suppressedSubjects.values()) {
    suppressions.push({
      subject: entry.subject,
      policy: entry.policy,
      factoryName: entry.creationFactoryName,
      createsNewObject: entry.subject.createsNewObject,
    });
  }

  return Object.freeze({
    plannable: Object.freeze(plannable),
    suppressions: Object.freeze(suppressions),
  });
}

function subjectKey(subject: ControlPolicySubject): string {
  return `${subject.namespaceId}\u0000${subject.entityKind ?? ''}\u0000${subject.entityName ?? ''}\u0000${subject.rlsPolicy ?? ''}`;
}
