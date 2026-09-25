import type { Contract } from '@internal/contract/types';
import type { CodecDescriptor, CodecRef } from '@internal/framework-components/codec';
import type { AggregateResultNullability } from '@internal/framework-components/components';
import type { MutationDefaults } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlOperationRegistry } from '@internal/sql-operations';
import type { SqlAggregateDescriptor, SqlAggregateLowering } from './aggregate-descriptor';
import type { ContractCodecRegistry } from './ast/codec-types';

/**
 * Codec-id-keyed accessor for descriptor metadata. The unified read API for codec-id-keyed metadata (`traits`, `targetTypes`) — non-branching for parameterized vs. non-parameterized codecs. Every codec ships natively as a `CodecDescriptor` through the unified `codecs:` contributor slot (see ADR 208).
 */
export interface CodecDescriptorRegistry {
  /**
   * Descriptors carry distinct param shapes per codec id; the registry is heterogeneous and the consumer narrows per codec.
   */
  descriptorFor(codecId: string): CodecDescriptor<unknown> | undefined;
  /**
   * Derive the canonical {@link CodecRef} for a contract `(table, column)`. The builder side calls this at AST construction time to stamp `codec` onto every column-bound `ParamRef` / `ProjectionItem`; the runtime side uses the result as the cache key into the content-keyed codec resolver.
   *
   * Resolution rules over `storage.namespaces[namespaceId].tables[table].columns[column]`:
   *
   * - `typeRef` column → emit `{codecId, typeParams}` from `storage.types[typeRef]` (multiple columns sharing the typeRef produce the same ref → same memoised codec).
   * - inline `typeParams` column → emit `{codecId, typeParams}` from the column itself.
   * - non-parameterized column → emit `{codecId}` with `typeParams` undefined (keys as `${codecId}:undefined` → one shared codec).
   *
   * The `namespaceId` coordinate leads and is always supplied — the table is resolved strictly within that namespace, so two same-bare-named tables in different namespaces resolve to their own per-namespace columns/codecs without colliding.
   *
   * Returns `undefined` when the registry was built without contract storage (package-scoped registries used purely as descriptor lookups), when the table or column is unknown in the namespace, or when the column declares a `typeRef` that the storage doesn't define.
   */
  codecRefForColumn(namespaceId: string, table: string, column: string): CodecRef | undefined;
  /**
   * All registered descriptors. Used by `validateCodecRegistryCompleteness` and other startup-time consumers that enumerate descriptors.
   */
  values(): IterableIterator<CodecDescriptor<unknown>>;
  /**
   * Descriptors indexed by `targetTypes[i]` (each scalar type the codec advertises). Multiple descriptors may map to the same scalar type; ordering reflects registration order.
   */
  byTargetType(targetType: string): readonly CodecDescriptor<unknown>[];
}

/**
 * What one aggregate resolves to: the codec its result carries, how that result reads where no row carries it, and the optional hook that builds the expression.
 *
 * The resolved value carries no descriptor, so a lowering hook has no channel through which to report a different result codec than the one resolved here.
 */
export type ResolvedSqlAggregate = AggregateResultNullability & {
  readonly operation: string;
  readonly output: CodecRef;
  readonly lower: SqlAggregateLowering | undefined;
};

/**
 * Resolution surface for aggregate result identity, assembled once per execution context.
 *
 * `resolve` is a lookup: every match — including trait matches, which depend on the composed codec set — is settled while the registry is built, so an ambiguous or malformed contribution fails at composition rather than mid-query.
 */
export interface SqlAggregateDescriptorRegistry {
  /**
   * The result identity of `operation` over an input carrying `input`, or `undefined` when no contributed descriptor claims that pair.
   *
   * Omit `input` for operations that consume no value; a descriptor matching by codec id or trait never answers an input-less call, and a descriptor matching `none` never answers a call carrying an input.
   */
  resolve(operation: string, input?: CodecRef): ResolvedSqlAggregate | undefined;
  /** Every validated descriptor, in contribution order. */
  values(): IterableIterator<SqlAggregateDescriptor>;
}

/**
 * Registry of initialized type helpers from storage.types. Each key is a type name from storage.types, and the value is the resolved codec materialized once for that named instance via `descriptor.factory(typeParams)(ctx)` (or the raw `StorageTypeInstance` metadata for codec ids whose descriptor isn't registered).
 */
export type TypeHelperRegistry = Record<string, unknown>;

/**
 * Minimal context interface for SQL query lanes.
 *
 * Lanes only need contract, operations, and codecs to build typed ASTs and attach operation builders. This interface explicitly excludes runtime concerns like adapters, connection management, and transaction state.
 */
export interface ExecutionContext<TContract extends Contract<SqlStorage> = Contract<SqlStorage>>
  extends MutationDefaults {
  readonly contract: TContract;
  /**
   * Contract-bound codec registry built once at context-construction time by walking the contract's columns and resolving each through its descriptor's factory. Runtime dispatch (`encodeParam` / `decodeRow`) resolves codecs via `forCodecRef(ref)` — the single dispatch shape for AST-bound codec resolution.
   */
  readonly contractCodecs: ContractCodecRegistry;
  /**
   * Codec-id-keyed descriptor map. Single source of truth for codec-id-keyed metadata (`traits`, `targetTypes`) — every codec, parameterized or not, resolves through this map without branching.
   */
  readonly codecDescriptors: CodecDescriptorRegistry;
  /**
   * Aggregate result identity, resolved from the descriptors the composed stack contributes. Planners ask it what codec an aggregate's result carries instead of assuming the input codec or a fixed target codec id.
   */
  readonly aggregateDescriptors: SqlAggregateDescriptorRegistry;
  readonly queryOperations: SqlOperationRegistry;
  /**
   * Type helper registry for parameterized types. Schema builders expose these helpers via schema.types.
   */
  readonly types: TypeHelperRegistry;
}
