import type { Contract } from '@internal/contract/types';
import type {
  ContractSerializer,
  DiffSubjectGranularity,
  MigratableTargetDescriptor,
  SchemaVerifier,
} from '@internal/framework-components/control';
import type { PslDocumentAst } from '@internal/framework-components/psl-ast';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlOperationDescriptors } from '@internal/sql-operations';
import type { SqlSchemaIR, SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import type { SqlControlAdapter } from './control-adapter';
import type { SqlControlFamilyInstance } from './control-instance';
import type { SqlSchemaDiffFn } from './migrations/schema-differ';
import type { SqlMigrationPlanner, SqlMigrationRunner } from './migrations/types';

/**
 * One stack extension pack's already-assembled contract, paired with the
 * `spaceId` its extension descriptor was registered under. `contract infer`
 * needs both: the contract to know which elements the pack describes and to
 * resolve the domain model a cross-space foreign key targets, the `spaceId`
 * to qualify the emitted relation type (`<spaceId>:<namespace>.<Model>`).
 * Neither the contract JSON nor the framework's `ContractSpace` wrapper
 * self-declares its owning space id — it is only known from the extension
 * descriptor that carries the `ContractSpace`.
 */
export interface SqlDescribedContractSpace {
  readonly spaceId: string;
  readonly contract: Contract<SqlStorage>;
}

export interface SqlControlTargetDescriptor<
  TTargetId extends string,
  TTargetDetails,
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends MigratableTargetDescriptor<'sql', TTargetId, SqlControlFamilyInstance> {
  readonly queryOperations?: () => SqlOperationDescriptors;
  /**
   * JSON ⇄ class boundary for the SQL target's contract. The descriptor
   * composes a concrete `SqlContractSerializerBase` subclass; the rest
   * of the control stack reaches `descriptor.contractSerializer` rather
   * than importing a per-target deserialization function.
   */
  readonly contractSerializer: ContractSerializer<TContract>;
  /**
   * Per-target schema verifier walking the contract against
   * `SqlSchemaIR`. The descriptor composes a concrete
   * `SqlSchemaVerifierBase` subclass; the family-shared walk lives on
   * the base, the target-specific dispatch on the subclass.
   */
  readonly schemaVerifier: SchemaVerifier<TContract, SqlSchemaIR>;
  /**
   * Database→PSL inference for `contract infer`. Target logic (owns the dialect
   * maps), so it lives on the descriptor. Optional: targets without `contract
   * infer` (Mongo) omit it, and the family instance throws when it is absent.
   * `describedContracts` carries the stack's extension packs' already-assembled
   * contracts (each paired with its `spaceId`) so the inferrer can omit elements
   * they already describe, and can qualify a cross-space relation with the
   * owning pack's space id.
   */
  readonly inferPslContract?: (
    schema: SqlSchemaIRNode,
    describedContracts?: readonly SqlDescribedContractSpace[],
  ) => PslDocumentAst;
  /**
   * Contract→PSL printing for `contract convert`. The reverse of
   * {@link inferPslContract}: it takes an already-assembled family contract and
   * returns the PSL document that reads back as the same contract. Target logic
   * for the same reason — it owns the dialect maps — so it lives beside its
   * sibling on the descriptor. Optional: targets without `contract convert`
   * omit it, and the family instance throws when it is absent.
   */
  readonly printPslContract?: (contract: TContract) => PslDocumentAst;
  /**
   * The full-tree node diff the family verify verdict derives from —
   * expected-tree derivation, pre-diff normalization, the generic differ,
   * and ownership scoping, all target-side. The family applies strict
   * gating + control-policy disposition over the returned issues; verify
   * rejects when a surviving issue is a failure.
   */
  readonly diffSchema: SqlSchemaDiffFn;
  /**
   * Classifies a diff-tree node's `nodeKind` into its framework-neutral
   * {@link DiffSubjectGranularity} — the target owns the full node vocabulary
   * that appears in its diff tree (its own kinds plus the relational kinds it
   * delegates to), so it is the one place that can resolve this. The family
   * verdict calls it inline per issue (never stamping the result); the
   * framework aggregate's unclaimed-elements sweep reaches the same
   * classifier via the family instance's `classifySubjectGranularity`
   * capability.
   */
  readonly classifySubjectGranularity: (nodeKind: string) => DiffSubjectGranularity;
  /**
   * Classifies a diff-tree node's `nodeKind` into its storage `entityKind` —
   * the same vocabulary the contract storage's `entries` dictionary keys use
   * (e.g. `'table'`). Sibling of `classifySubjectGranularity`, resolved the
   * same way: the target owns the full node vocabulary, so it is the one
   * place that can resolve this. `undefined` for a node kind with no
   * storage entity of its own (a column, an index, …). The framework
   * aggregate's unclaimed-elements sweep reaches this via the family
   * instance's `classifyEntityKind` capability, so it never hardcodes a
   * family entity kind.
   */
  readonly classifyEntityKind: (nodeKind: string) => string | undefined;
  createPlanner(adapter: SqlControlAdapter<TTargetId>): SqlMigrationPlanner<TTargetDetails>;
  createRunner(family: SqlControlFamilyInstance): SqlMigrationRunner<TTargetDetails>;
}
