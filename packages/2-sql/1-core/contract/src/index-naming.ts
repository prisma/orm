import type {
  AuthoringWarning,
  AuthoringWarningSink,
} from '@internal/framework-components/authoring';
import { flushAuthoringWarnings } from '@internal/framework-components/authoring';
import {
  assertWireNamePrefixLength,
  computeIndexContentHash,
  defaultIndexName,
} from '@internal/sql-schema-ir/naming';
import { contractError } from './contract-errors';
import type { IndexInput } from './ir/sql-index';

/**
 * The authored element structure: a fields index carries `columns`, an
 * expression index carries `expression` — exactly one, never both.
 */
export type AuthoredIndexElements =
  | { readonly columns: readonly string[]; readonly expression?: never }
  | { readonly columns?: never; readonly expression: string };

/**
 * The authored access method: options only exist as options *of a type*, so
 * the pair is one two-arm union rather than two independent fields. An
 * options bag without a type is therefore unrepresentable, the same way
 * {@link AuthoredIndexElements} makes columns-with-expression
 * unrepresentable.
 */
export type AuthoredIndexMethod =
  | { readonly type: undefined; readonly options: undefined }
  | { readonly type: string; readonly options: Record<string, unknown> | undefined };

/**
 * An index as authored, before naming: `map` is an exact physical name
 * (adopted verbatim); `name` is a wire-name prefix. With neither,
 * the wire prefix defaults to `defaultIndexName(table, columns)`.
 * `where`, `unique`, `type`, and `options` participate in the content hash
 * alongside the elements.
 */
export type AuthoredIndexInput = AuthoredIndexElements &
  AuthoredIndexMethod & {
    readonly where: string | undefined;
    readonly unique: boolean | undefined;
    readonly map: string | undefined;
    readonly name: string | undefined;
  };

const EXACT_NAME_BODY_PREAMBLE =
  "Drift detection compares the authored SQL text byte-for-byte against Postgres's reprinted form, which is only reliable when the text was captured by contract infer.";

/**
 * Per-subject remediation: an index or check moves to wire naming via
 * `name:`; a policy has no such parameter — dropping `@@map` makes the
 * block's head the wire prefix.
 */
const EXACT_NAME_BODY_REMEDIATION = {
  index:
    'For hand-authored definitions, use name: and let Prisma 8 manage the physical name; to migrate an adopted object to wire naming, replace map: with name: (keeping the body text unchanged) and apply the resulting rename migration.',
  policy:
    "For hand-authored definitions, drop @@map and let the policy block's head name the policy; to migrate an adopted policy to wire naming, remove @@map (keeping the body text unchanged) and apply the resulting rename migration.",
  check:
    'For hand-authored definitions, use name: and let Prisma 8 manage the physical name; to migrate an adopted check to wire naming, replace map: with name: (keeping the body text unchanged) and apply the resulting rename migration.',
} as const;

/** What the user actually wrote, per subject: index and check `map:`, policy `@@map`. */
const EXACT_NAME_FEATURE = {
  index: 'map:',
  policy: '@@map',
  check: 'map:',
} as const;

const EXACT_NAME_BODY_WARNING_CODE = 'PN_EXACT_NAME_BODY_COMPARISON';

/**
 * Mints the exact-name body-comparison warning for a `map:`-named object
 * carrying a hand-authorable SQL body — fully formed, so the transport and
 * the flush stay generic. `subject` distinguishes the index, policy, and
 * check callers that mint this same warning; the feature name and the
 * remediation are subject-specific end to end, so a batched summary
 * (grouped on code + summary) is true of every object it covers.
 */
export function exactNameBodyWarning(
  subject: 'index' | 'policy' | 'check',
  exactName: string,
): AuthoringWarning {
  const item = `${subject} "${exactName}"`;
  const feature = EXACT_NAME_FEATURE[subject];
  const tail = `with a SQL body. ${EXACT_NAME_BODY_PREAMBLE} ${EXACT_NAME_BODY_REMEDIATION[subject]}`;
  return {
    code: EXACT_NAME_BODY_WARNING_CODE,
    message: `${item} uses ${feature} ${tail}`,
    item,
    summary: `objects use ${feature} ${tail}`,
  };
}

/**
 * Lowers an authored index into the name-identified entity `contract.json`
 * persists: exact mode adopts `map` verbatim (no prefix, no hash); wire
 * mode appends the content-hash suffix to the authored or default prefix.
 * The cross-field guards are the shared enforcement backstop for both
 * authoring surfaces (PSL pre-empts them with span-anchored diagnostics).
 */
export function lowerAuthoredIndex(
  tableName: string,
  authored: AuthoredIndexInput,
  warnings?: AuthoringWarningSink,
): IndexInput {
  if ((authored.columns === undefined) === (authored.expression === undefined)) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `Index on table "${tableName}": an index takes either fields (columns) or an expression — exactly one, not both.`,
    );
  }
  if (authored.map !== undefined && authored.name !== undefined) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `Index "${authored.map}" on table "${tableName}": map and name are mutually exclusive — map adopts an exact physical name, name is a wire prefix.`,
    );
  }
  if (
    authored.expression !== undefined &&
    authored.name === undefined &&
    authored.map === undefined
  ) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `Index on table "${tableName}": an expression index requires an explicit name (name:) or exact physical name (map:) — a default name cannot be derived from an expression.`,
    );
  }
  if (authored.options !== undefined && authored.type === undefined) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      `Index on table "${tableName}": options requires an explicit type — an index with options but no type cannot round-trip through contract infer (the emitted type: would change the wire name).`,
    );
  }

  const unique = authored.unique ?? false;

  if (authored.map !== undefined) {
    if (authored.expression !== undefined || authored.where !== undefined) {
      const warning: AuthoringWarning = exactNameBodyWarning('index', authored.map);
      if (warnings !== undefined) {
        warnings.push(warning);
      } else {
        flushAuthoringWarnings([warning]);
      }
    }
    const carried = {
      naming: { kind: 'exact' as const, name: authored.map },
      where: authored.where,
      unique,
      type: authored.type,
      options: authored.options,
    };
    return authored.expression !== undefined
      ? { ...carried, expression: authored.expression }
      : { ...carried, columns: authored.columns ?? [] };
  }

  const prefix = authored.name ?? defaultIndexName(tableName, authored.columns ?? []);
  assertWireNamePrefixLength(prefix, 'index prefix');
  const hash = computeIndexContentHash({
    ...(authored.columns !== undefined && { columns: authored.columns }),
    ...(authored.expression !== undefined && { expression: authored.expression }),
    ...(authored.where !== undefined && { where: authored.where }),
    unique,
    ...(authored.type !== undefined && { type: authored.type }),
    ...(authored.options !== undefined && { options: authored.options }),
  });
  const carried = {
    naming: { kind: 'wire' as const, prefix, hash },
    where: authored.where,
    unique,
    type: authored.type,
    options: authored.options,
  };
  return authored.expression !== undefined
    ? { ...carried, expression: authored.expression }
    : { ...carried, columns: authored.columns ?? [] };
}
