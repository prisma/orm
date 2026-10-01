import type { JsonObject } from '@internal/utils/json';
import type { ControlPolicy } from './control-policy';
import type { CrossReference } from './cross-reference';
import type { ApplicationDomain } from './domain-envelope';
import type { ContractValueObject } from './domain-types';
import type {
  ExecutionHashBase,
  ExecutionMutationDefault,
  ProfileHashBase,
  StorageBase,
} from './types';

/**
 * Execution section for the unified contract (ADR 182).
 *
 * Unlike the legacy {@link import('./types').ExecutionSection}, this type
 * requires `executionHash` — when an execution section is present, its
 * hash must be too (consistent with `StorageBase.storageHash`).
 *
 * @template THash  Literal hash string type for type-safe hash tracking.
 */
export type ContractExecutionSection<THash extends string = string> = {
  readonly executionHash: ExecutionHashBase<THash>;
  readonly mutations: {
    readonly defaults: ReadonlyArray<ExecutionMutationDefault>;
  };
};

/**
 * Unified contract representation (ADR 182).
 *
 * A `Contract` is the canonical in-memory representation of a data contract.
 * It is model-first (domain models carry their own storage bridge) and
 * family-parameterized (SQL, Mongo, etc. specialize via `TStorage` and model
 * storage generics on `ContractModel`).
 *
 * JSON persistence fields (`schemaVersion`, `sources`) are not represented
 * here — they are handled at the serialization boundary.
 *
 * @template TStorage  Family-specific storage block (extends {@link StorageBase}).
 */
export interface Contract<TStorage extends StorageBase = StorageBase> {
  readonly target: string;
  readonly targetFamily: string;
  readonly roots: Record<string, CrossReference>;
  /**
   * Application plane (ADR 221): `domain.namespaces.<nsId>.{ models, valueObjects }`.
   */
  readonly domain: ApplicationDomain;
  readonly storage: TStorage;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly extensions: Record<string, unknown>;
  readonly execution?: ContractExecutionSection;
  readonly profileHash: ProfileHashBase<string>;
  readonly meta: Record<string, unknown>;
  readonly defaultControlPolicy?: ControlPolicy;
  /**
   * Planner hints from the authoring layer. Family-defined shape; never hashed; stripped from
   * snapshots.
   */
  readonly hints?: JsonObject;
}

type ExactlyOneNamespace<T extends Record<string, unknown>> = keyof T extends infer Only extends
  keyof T
  ? [keyof T] extends [Only]
    ? Only
    : never
  : never;

type NamespaceValueObjectsOf<TNamespace> = TNamespace extends {
  readonly valueObjects?: infer VO;
}
  ? VO extends Record<string, ContractValueObject>
    ? VO
    : Record<never, never>
  : Record<never, never>;

/** Value-object map when the contract declares exactly one domain namespace. */
export type ContractValueObjectDefinitions<TContract extends Contract> =
  NamespaceValueObjectsOf<
    TContract['domain']['namespaces'][ExactlyOneNamespace<TContract['domain']['namespaces']>]
  > extends infer Projected
    ? Projected extends Record<string, ContractValueObject>
      ? Projected
      : Record<never, never>
    : Record<never, never>;
