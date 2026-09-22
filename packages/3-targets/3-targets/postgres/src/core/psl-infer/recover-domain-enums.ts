import {
  composeCheckWirePrefix,
  computeCheckContentHash,
  formatWireName,
  parseWireName,
} from '@internal/sql-schema-ir/naming';
import type { SqlColumnIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { postgresRenderCheckExpressions } from '../check-expressions';
import { PG_CHAR_CODEC_ID, PG_TEXT_CODEC_ID, PG_VARCHAR_CODEC_ID } from '../codec-ids';
import { parsePostgresDefault } from '../default-normalizer';
import { harvestCheckLiterals } from './harvest-check-literals';

/** A column proven to carry a toolchain-derived membership check. */
export interface RecoveredEnumColumn {
  readonly memberValues: readonly string[];
  readonly codecId: string;
}

const RECOVERABLE_NATIVE_TYPE_CODECS: Readonly<Record<string, string>> = {
  text: PG_TEXT_CODEC_ID,
  'character varying': PG_VARCHAR_CODEC_ID,
  character: PG_CHAR_CODEC_ID,
  'character(1)': PG_CHAR_CODEC_ID,
};

/**
 * The codec id a recovered enum's `@@type` carries for a column of this
 * native type, or undefined when no text-backed codec maps — an unmapped
 * type is simply not recovered, never an error. The keys are the spellings
 * introspection actually produces (`format_type` renders canonical long
 * names, never `varchar`/`char`/`bpchar`). A parameterized spelling like
 * `varchar(20)` must keep its `@@check`, because `@@type` re-emits the
 * codec's bare target type and the planner would widen the column to it —
 * except `character(1)`, which IS the bare `character` type: a length-less
 * `char` column always introspects with the implicit `(1)`.
 */
function recoveredEnumCodecId(nativeType: string): string | undefined {
  return Object.hasOwn(RECOVERABLE_NATIVE_TYPE_CODECS, nativeType)
    ? RECOVERABLE_NATIVE_TYPE_CODECS[nativeType]
    : undefined;
}

/**
 * An enum-typed field's `@default` must be a bare member identifier — the
 * interpreter rejects a string literal there — so a recovered column's
 * default must be a literal member value. Any other default blocks recovery
 * and the column keeps today's proven form: scalar type, `@@check`, and the
 * default printed as-is.
 */
function defaultIsRepresentable(column: SqlColumnIR, memberValues: readonly string[]): boolean {
  if (column.default === undefined) return true;
  const parsed = parsePostgresDefault(column.default, column.nativeType);
  return (
    parsed?.kind === 'literal' &&
    typeof parsed.value === 'string' &&
    memberValues.includes(parsed.value)
  );
}

/**
 * Path A verification (project spec): for each live check whose name is
 * wire-shaped with the membership prefix of some column of its table,
 * harvest the reprint's string literals, re-render the membership predicate
 * from them through the real authoring renderer, and recompute the wire
 * name. An exact full-name match proves the check was derived from a domain
 * enum with exactly those member values, in that order — the hash was
 * computed over the authored render, which this reconstructs byte-for-byte.
 *
 * Anything that fails a step — non-wire name, empty harvest, hash mismatch,
 * or a column native type with no text-backed codec — recovers nothing and
 * leaves the check to today's `@@check` emission.
 */
export function recoverDomainEnumColumns(
  tables: Readonly<Record<string, SqlTableIR>>,
): ReadonlyMap<string, ReadonlyMap<string, RecoveredEnumColumn>> {
  const recoveredByTable = new Map<string, ReadonlyMap<string, RecoveredEnumColumn>>();
  for (const table of Object.values(tables)) {
    const recovered = new Map<string, RecoveredEnumColumn>();
    for (const check of table.checks ?? []) {
      const wire = parseWireName(check.name);
      if (wire === undefined) continue;
      for (const column of Object.values(table.columns)) {
        if (recovered.has(column.name)) continue;
        if (wire.prefix !== composeCheckWirePrefix(table.name, column.name, 'membership')) {
          continue;
        }
        const memberValues = harvestCheckLiterals(check.expression);
        if (memberValues.length === 0) continue;
        const candidate = postgresRenderCheckExpressions({
          tableName: table.name,
          columnName: column.name,
          many: column.many === true,
          memberValues,
        }).find((c) => c.kind === 'membership');
        if (candidate === undefined) continue;
        const derivedName = formatWireName(
          wire.prefix,
          computeCheckContentHash(candidate.expression),
        );
        if (derivedName !== check.name) continue;
        const codecId = recoveredEnumCodecId(column.nativeType);
        if (codecId === undefined) continue;
        if (!defaultIsRepresentable(column, memberValues)) continue;
        recovered.set(column.name, { memberValues, codecId });
      }
    }
    if (recovered.size > 0) {
      recoveredByTable.set(table.name, recovered);
    }
  }
  return recoveredByTable;
}
