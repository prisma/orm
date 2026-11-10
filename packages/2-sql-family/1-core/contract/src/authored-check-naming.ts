import type {
  AuthoringWarning,
  AuthoringWarningSink,
} from '@internal/framework-components/authoring';
import { flushAuthoringWarnings } from '@internal/framework-components/authoring';
import {
  assertWireNamePrefixLength,
  computeCheckContentHash,
} from '@internal/sql-schema-ir/naming';
import { contractError } from './contract-errors';
import { exactNameBodyWarning } from './index-naming';
import type { CheckConstraintInput } from './ir/check-constraint';

/**
 * A check constraint as authored, before naming: `map` is an exact physical
 * name (adopted verbatim); `name` is a wire-name prefix. Unlike an index,
 * there is no derivable default — a check has no column tuple to name itself
 * after — so exactly one of `name` or `map` is required.
 */
export type AuthoredCheckInput = {
  readonly expression: string;
  readonly map: string | undefined;
  readonly name: string | undefined;
};

/**
 * Lowers an authored check constraint into the name-identified entity
 * `contract.json` persists: exact mode adopts `map` verbatim (no prefix, no
 * hash) and warns, because a hand-authored body compared verbatim against
 * Postgres's reprint would false-drift; wire mode appends the content-hash
 * suffix to the authored prefix. There is no default prefix to fall back on
 * — a check has no column tuple to derive one from, unlike an index — so an
 * absent `name` is only valid alongside a present `map`. The cross-field
 * guards are the shared enforcement backstop for both authoring surfaces
 * (PSL pre-empts them with span-anchored diagnostics).
 */
export function lowerAuthoredCheck(
  tableName: string,
  authored: AuthoredCheckInput,
  warnings?: AuthoringWarningSink,
): CheckConstraintInput {
  if (authored.map !== undefined && authored.name !== undefined) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `Check "${authored.map}" on table "${tableName}": map and name are mutually exclusive — map adopts an exact physical name, name is a wire prefix.`,
    );
  }
  if (authored.expression.trim().length === 0) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `Check on table "${tableName}": expression must not be empty — an empty predicate is not a constraint.`,
    );
  }

  if (authored.map !== undefined) {
    const warning: AuthoringWarning = exactNameBodyWarning('check', authored.map);
    if (warnings !== undefined) {
      warnings.push(warning);
    } else {
      flushAuthoringWarnings([warning]);
    }
    return {
      naming: { kind: 'exact', name: authored.map },
      expression: authored.expression,
    };
  }

  if (authored.name === undefined) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `Check on table "${tableName}": a check constraint requires an explicit name (name:) or exact physical name (map:) — unlike an index there is no column tuple to derive a default name from.`,
    );
  }

  const prefix = authored.name;
  assertWireNamePrefixLength(prefix, 'check prefix');
  const hash = computeCheckContentHash(authored.expression);
  return {
    naming: { kind: 'wire', prefix, hash },
    expression: authored.expression,
  };
}
