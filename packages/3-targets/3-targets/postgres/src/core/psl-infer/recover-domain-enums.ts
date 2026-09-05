import {
  composeCheckWirePrefix,
  computeCheckContentHash,
  formatWireName,
  parseWireName,
} from '@internal/sql-schema-ir/naming';
import type { SqlTableIR } from '@internal/sql-schema-ir/types';
import { postgresRenderCheckExpressions } from '../check-expressions';
import { PG_CHAR_CODEC_ID, PG_TEXT_CODEC_ID, PG_VARCHAR_CODEC_ID } from '../codec-ids';
import { harvestCheckLiterals } from './harvest-check-literals';

/** A column proven to carry a toolchain-derived membership check. */
export interface RecoveredEnumColumn {
  readonly memberValues: readonly string[];
  readonly codecId: string;
}

const RECOVERABLE_NATIVE_TYPE_CODECS: Readonly<Record<string, string>> = {
  text: PG_TEXT_CODEC_ID,
  varchar: PG_VARCHAR_CODEC_ID,
  'character varying': PG_VARCHAR_CODEC_ID,
  char: PG_CHAR_CODEC_ID,
  character: PG_CHAR_CODEC_ID,
};

/**
 * The codec id a recovered enum's `@@type` carries for a column of this
 * native type, or undefined when no text-backed codec maps — an unmapped
 * type is simply not recovered, never an error. Only the exact codec target
 * spellings map: a parameterized spelling like `varchar(20)` must keep its
 * `@@check`, because `@@type` re-emits the codec's bare target type and the
 * planner would widen the column to it.
 */
function recoveredEnumCodecId(nativeType: string): string | undefined {
  return Object.hasOwn(RECOVERABLE_NATIVE_TYPE_CODECS, nativeType)
    ? RECOVERABLE_NATIVE_TYPE_CODECS[nativeType]
    : undefined;
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
        recovered.set(column.name, { memberValues, codecId });
      }
    }
    if (recovered.size > 0) {
      recoveredByTable.set(table.name, recovered);
    }
  }
  return recoveredByTable;
}
