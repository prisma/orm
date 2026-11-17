import { runtimeError } from '@internal/framework-components/runtime';
import type { ContractCodecRegistry, SqlCodecCallContext } from '@internal/sql-relational-core/ast';
import { encodeParamsWithMetadata } from '../codecs/encoding';
import type { PreparedStatementInternals } from './prepared-statement';

/**
 * Resolve a PreparedStatement's slot order to the unencoded values it
 * will carry into encode. Literal slots come from the lowered AST;
 * bind slots are looked up by name on `userParams`. Missing user params
 * surface `RUNTIME.PREPARE_MISSING_PARAM` so the caller cannot silently
 * bind `undefined`.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function resolvePreparedSlotValues(
  ps: PreparedStatementInternals,
  userParams: unknown,
): unknown[] {
  if (!isRecord(userParams)) {
    throw runtimeError(
      'RUNTIME.PREPARE_MISSING_PARAM',
      'Prepared statement parameters must be an object',
    );
  }
  return ps.slots.map((slot) => {
    if (slot.kind === 'literal') return slot.value;
    if (!Object.hasOwn(userParams, slot.name)) {
      throw runtimeError(
        'RUNTIME.PREPARE_MISSING_PARAM',
        `Prepared statement query is missing parameter '${slot.name}'`,
        { name: slot.name },
      );
    }
    return userParams[slot.name];
  });
}

export async function encodePreparedParams(
  ps: PreparedStatementInternals,
  userParams: unknown,
  ctx: SqlCodecCallContext,
  contractCodecs?: ContractCodecRegistry,
): Promise<readonly unknown[]> {
  const resolved = resolvePreparedSlotValues(ps, userParams);
  return encodeParamsWithMetadata(resolved, ps.paramMetadata, ctx, contractCodecs);
}
