import type { ContractMarkerRecord } from '@internal/contract/types';
import type { SqlQueryable } from './driver-types';
import type { LoweredStatement } from './types';

export type AdapterTarget = string;

/**
 * Outcome of an adapter's marker read. `no-table` means the marker storage itself is absent
 * (e.g. attaching to a database that was never `db init`'d); `absent` means the storage exists
 * but holds no row for the requested space; `present` carries the parsed record. Callers
 * distinguish these to produce appropriate log diagnostics for each case.
 */
export type MarkerReadResult =
  | { readonly kind: 'present'; readonly record: ContractMarkerRecord }
  | { readonly kind: 'absent' }
  | { readonly kind: 'no-table' };

export interface AdapterProfile<TTarget extends AdapterTarget = AdapterTarget> {
  readonly id: string;
  readonly target: TTarget;
  readonly capabilities: Record<string, unknown>;
  /**
   * Reads the contract marker via the supplied queryable. The adapter owns the full flow — probing for the marker storage, issuing the read, and decoding the row — so callers receive a tagged result rather than a raw driver error when the marker storage is absent.
   */
  readMarker(queryable: SqlQueryable): Promise<MarkerReadResult>;
}

export interface LowererContext<TContract = unknown> {
  readonly contract: TContract;
  readonly params?: readonly unknown[];
}

export type Lowerer<Ast = unknown, TContract = unknown, TBody = LoweredStatement> = (
  ast: Ast,
  context: LowererContext<TContract>,
) => TBody;

/**
 * Lowers a query AST into a target-specific executable body (typically `LoweredStatement` for SQL adapters). The `lower` method returns the body directly; per-statement metadata, when needed, lives on the body itself (e.g. `LoweredStatement.annotations`). Adapter-level metadata such as the profile id is reachable via `profile.id` for callers that genuinely need it.
 */
export interface Adapter<Ast = unknown, TContract = unknown, TBody = LoweredStatement> {
  readonly profile: AdapterProfile;
  lower(ast: Ast, context: LowererContext<TContract>): TBody;
}
