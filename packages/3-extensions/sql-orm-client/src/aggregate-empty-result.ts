import type { AggregateResultNullability } from '@internal/framework-components/components';
import type { Codec } from '@internal/sql-relational-core/ast';

/**
 * What an aggregate reads as when there is no row to read at all.
 *
 * SQL answers an empty input set itself — a nullable-declared aggregate
 * collapses to NULL, a non-nullable one to a value SQL still produces, a
 * count's zero cardinality — so this covers only the degenerate case of a
 * result set with no row: an absent aggregate alias, or an include whose
 * envelope never arrived. The answer reads off the operation's declared row:
 * NULL where the row is nullable, else the wire value the row declares, read
 * with the declared codec's `fromWire` — so the application sees the same value
 * shape a real row would produce.
 */
export async function emptyAggregateResult(
  result: AggregateResultNullability,
  codec: Codec,
): Promise<unknown> {
  return result.nullable ? null : codec.fromWire(result.emptyResultWire, {});
}
