import type { ContractMarkerRecord } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import type { JsonValue } from '@internal/utils/json';
import { type } from 'arktype';
import { sqlFamilyError } from './errors';

const MetaSchema = type({ '[string]': 'unknown' });

function parseMeta(meta: unknown): Record<string, unknown> {
  if (meta === null || meta === undefined) {
    return {};
  }

  let parsed: unknown;
  if (typeof meta === 'string') {
    try {
      parsed = JSON.parse(meta);
    } catch {
      return {};
    }
  } else {
    parsed = meta;
  }

  const result = MetaSchema(parsed);
  if (result instanceof type.errors) {
    return {};
  }

  return blindCast<
    Record<string, unknown>,
    'MetaSchema validates the value as a string-keyed record before returning it'
  >(result);
}

/**
 * SQLite stores `contract_json` as TEXT, so the wire shape is a JSON string;
 * Postgres uses `jsonb` and returns an already-parsed value. Normalize both
 * here so `ContractMarkerRecord.contractJson` is always the structured form.
 */
function parseContractJson(value: unknown): JsonValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    return blindCast<JsonValue, 'database JSON column value is already parsed JSON data'>(value);
  }
  try {
    return blindCast<JsonValue, 'JSON.parse returns the parsed JSON payload from the marker row'>(
      JSON.parse(value),
    );
  } catch {
    return null;
  }
}

/**
 * Wire shape of a `prisma_contract.marker` row as it comes out of a SQL
 * driver. Snake-cased to match the on-disk column names. Shared by every
 * SQL target's `readMarker` so each runner doesn't redeclare it inline.
 */
export type ContractMarkerRow = {
  core_hash: string;
  profile_hash: string;
  contract_json: unknown | null;
  canonical_version: number | null;
  updated_at: Date | string;
  app_tag: string | null;
  meta: unknown | null;
  // SQLite stores arrays as JSON-TEXT, so this is `string` on the wire from
  // a SQLite driver and `string[]` from a Postgres driver. Targets normalize
  // before passing to `parseContractMarkerRow`.
  invariants: unknown;
};

const ContractMarkerRowSchema = type({
  core_hash: 'string',
  profile_hash: 'string',
  'contract_json?': 'unknown | null',
  'canonical_version?': 'number | null',
  'updated_at?': 'Date | string',
  'app_tag?': 'string | null',
  'meta?': 'unknown | null',
  invariants: type('string').array(),
});

/**
 * Parses a contract marker row from database query result.
 * This is SQL-specific parsing logic (handles SQL row structure with snake_case columns).
 */
export function parseContractMarkerRow(row: unknown): ContractMarkerRecord {
  const result = ContractMarkerRowSchema(row);
  if (result instanceof type.errors) {
    const messages = result.map((p: { message: string }) => p.message).join('; ');
    throw sqlFamilyError(
      'CONTRACT.MARKER_ROW_CORRUPT',
      `Invalid contract marker row: ${messages}`,
      {
        why: 'The contract marker row read from the database does not match the expected marker shape.',
        fix: 'Re-sign the database with `prisma db sign`, or repair the marker table.',
        nextActions: [
          { kind: 'run-command', label: 'Re-sign the database', command: '{bin} db sign' },
          { kind: 'user-choice', label: 'Repair the marker table by hand', reason: messages },
        ],
        meta: { issues: messages },
      },
    );
  }

  const updatedAt = result.updated_at
    ? result.updated_at instanceof Date
      ? result.updated_at
      : new Date(result.updated_at)
    : new Date();

  return {
    storageHash: result.core_hash,
    profileHash: result.profile_hash,
    contractJson: parseContractJson(result.contract_json),
    canonicalVersion: result.canonical_version ?? null,
    updatedAt,
    appTag: result.app_tag ?? null,
    meta: parseMeta(result.meta),
    invariants: result.invariants,
  };
}

/**
 * Collects supported codec type IDs from adapter and extension manifests.
 * Returns a sorted, unique array of type IDs that are declared in the manifests.
 * This enables coverage checks by comparing contract column types against supported types.
 *
 * Note: This extracts type IDs from manifest type imports, not from runtime codec registries.
 * The manifests declare which codec types are available, but the actual type IDs
 * are defined in the codec-types TypeScript modules that are imported.
 *
 * For MVP, we return an empty array since extracting type IDs from TypeScript modules
 * would require runtime evaluation or static analysis. This can be enhanced later.
 */
export function collectSupportedCodecTypeIds(
  descriptors: ReadonlyArray<{ readonly id: string }>,
): readonly string[] {
  // For MVP, return empty array
  // Future enhancement: Extract type IDs from codec-types modules via static analysis
  // or require manifests to explicitly list supported type IDs
  void descriptors;
  return [];
}
