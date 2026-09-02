import type {
  ColumnDefault,
  ControlPolicy,
  ExecutionMutationDefaultPhases,
} from '@internal/contract/types';
import type { ForeignKeyDefaultsState } from '@internal/contract-authoring';
import type { AuthoringWarning } from '@internal/framework-components/authoring';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import type { ExtensionPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { AuthoredIndexMethod } from '@internal/sql-contract/index-naming';
import type {
  ReferentialAction,
  SqlNamespaceBase,
  SqlNamespaceInput,
  StorageTypeInstance,
} from '@internal/sql-contract/types';
import type { CheckKind } from '@internal/sql-schema-ir/naming';
import type { EnumTypeHandle } from './enum-type';

export type { ExecutionMutationDefaultPhases };

/**
 * Namespace-scoped pack-entity attachments, the internal build IR carrying
 * the lowered `entities` handle list: namespace id → entity kind (the
 * discriminator the target/extension pack registered its
 * `AuthoringContributions.entityTypes` descriptor under, e.g. `native_enum`)
 * → entity name → the lowered entity instance. Generic on purpose — neither
 * the framework nor `contract-ts` names a specific entity kind here; the
 * shape mirrors `SqlNamespaceInput.entries` (`entries.<kind>[name]`), just
 * namespace-nested so an attachment can target any declared namespace
 * (default or named), not only the contract's default namespace. Produced by
 * the generic entity-handle walk in `buildContractDefinition`; never an
 * author-facing input.
 */
export type AttachedEntities = Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
>;

export interface FieldNode {
  readonly fieldName: string;
  readonly columnName: string;
  readonly descriptor: ColumnTypeDescriptor;
  readonly nullable: boolean;
  readonly default?: ColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
  readonly many?: boolean;
  /**
   * Generated-check kinds the author declined for this column. The PSL
   * interpreter always writes concrete kinds; the TS builder's bare
   * `noCheck()` arrives as `[]` and is resolved to the column shape's
   * derivable kinds at contract build time.
   */
  readonly noCheck?: readonly CheckKind[];
  /** Present when the field was authored with `field.namedType(enumHandle)`. */
  readonly enumTypeHandle?: EnumTypeHandle;
}

export interface PrimaryKeyNode {
  readonly columns: readonly string[];
  readonly name?: string;
}

export interface UniqueConstraintNode {
  readonly columns: readonly string[];
  readonly name?: string;
}

/** A definition-tree index's element structure — column tuple xor expression. */
export type IndexNodeElements =
  | {
      /** Column tuple. */
      readonly columns: readonly string[];
      readonly expression?: never;
    }
  | {
      readonly columns?: never;
      /** Opaque SQL: the entire element list of CREATE INDEX — never parsed. */
      readonly expression: string;
    };

export type IndexNode = IndexNodeElements &
  AuthoredIndexMethod & {
    /** Opaque SQL: partial-index predicate (WHERE body, without the keyword). */
    readonly where: string | undefined;
    readonly unique: boolean | undefined;
    /** Exact physical name (`map:`) — adopted verbatim, no wire hash. */
    readonly map: string | undefined;
    /** Wire-name prefix (`name:`) — lowers to `<name>_<8hex>`. */
    readonly name: string | undefined;
  };

/**
 * A definition-tree check constraint: `map` adopts an exact physical name
 * verbatim, `name` is a wire-name prefix — exactly one is required (a check
 * has no column tuple to derive a default from, unlike an index).
 */
export type CheckNode = {
  readonly expression: string;
  readonly map: string | undefined;
  readonly name: string | undefined;
};

export interface ForeignKeyNode {
  readonly columns: readonly string[];
  readonly references: {
    readonly model: string;
    readonly table: string;
    readonly columns: readonly string[];
    /**
     * Namespace coordinate of the referenced table. When omitted the
     * assembler resolves the coordinate from the referenced model node's
     * own `namespaceId`; the field exists so authoring paths that already
     * know the target namespace can stamp it explicitly.
     */
    readonly namespaceId?: string;
    /**
     * Contract-space identity of the referenced table. When present, the
     * table lives in a different contract space (identified by this value)
     * rather than the current contract. Absent for local FKs.
     */
    readonly spaceId?: string;
  };
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
  readonly constraint?: boolean;
  readonly index?: boolean;
}

export interface RelationNode {
  readonly fieldName: string;
  readonly toModel: string;
  readonly toTable: string;
  /**
   * Namespace coordinate of the related model. When omitted the assembler
   * resolves the coordinate from the referenced model node's own
   * `namespaceId`; the field exists so authoring paths that already know the
   * target namespace can stamp it explicitly — required to disambiguate a
   * relation to a model whose bare name also exists in another namespace.
   */
  readonly toNamespaceId?: string;
  readonly cardinality: '1:1' | '1:N' | 'N:1' | 'N:M';
  /**
   * Contract-space identity of the related model. When present, the
   * related model lives in a different contract space. Absent for local
   * (same-space) relations.
   */
  readonly spaceId?: string;
  /**
   * Namespace coordinate of the related model in the foreign space.
   * Only set when `spaceId` is present.
   */
  readonly namespaceId?: string;
  readonly on: {
    readonly parentTable: string;
    readonly parentColumns: readonly string[];
    readonly childTable: string;
    readonly childColumns: readonly string[];
  };
  readonly through?: {
    readonly table: string;
    /**
     * Namespace the junction table lives in. Set from the junction model's
     * declared namespace at lowering time; junction table names are unique per
     * namespace, not globally, so this disambiguates a junction whose bare table
     * name also exists in another namespace. Omitted for a junction in the
     * default namespace (resolved to the target's default at build time).
     */
    readonly namespaceId?: string;
    readonly parentColumns: readonly string[];
    readonly childColumns: readonly string[];
  };
}

export interface ValueObjectFieldNode {
  readonly fieldName: string;
  readonly columnName: string;
  readonly valueObjectName: string;
  readonly nullable: boolean;
  readonly default?: ColumnDefault;
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
  readonly many?: boolean;
}

export interface ValueObjectNode {
  readonly name: string;
  readonly fields: readonly (FieldNode | ValueObjectFieldNode)[];
}

export interface ModelNode {
  readonly modelName: string;
  readonly tableName: string;
  /**
   * Resolved namespace coordinate for this model — the key into the
   * parent contract's `SqlStorage.namespaces` map. Omitting the field
   * (or setting it to the framework's `UNBOUND_NAMESPACE_ID` sentinel)
   * selects the late-bound slot, which renders as unqualified DDL.
   *
   * Populated by per-target PSL interpreters from the resolved
   * `namespace { … }` AST bucket; the TS builder also sets it from the
   * per-model `namespace` field once that authoring surface lands.
   */
  readonly namespaceId?: string;
  readonly fields: readonly (FieldNode | ValueObjectFieldNode)[];
  readonly id?: PrimaryKeyNode;
  readonly uniques?: readonly UniqueConstraintNode[];
  readonly indexes?: readonly IndexNode[];
  readonly checks?: readonly CheckNode[];
  readonly foreignKeys?: readonly ForeignKeyNode[];
  readonly relations?: readonly RelationNode[];
  readonly control?: ControlPolicy;
  /**
   * Single-table-inheritance variants share their base model's storage table:
   * the variant's columns are materialised onto the base `ModelNode`, and this
   * model contributes a domain model but no storage table of its own. When set,
   * the assembler builds the domain model but skips creating a (shadow) storage
   * table and a root for this model — the base owns both.
   */
  readonly sharesBaseTable?: boolean;
}

export interface ContractDefinition {
  readonly target: TargetPackRef<'sql', string>;
  readonly defaultControlPolicy?: ControlPolicy;
  readonly extensions?: Record<string, ExtensionPackRef<'sql', string>>;
  /**
   * Test-fixture escape hatch: pins the emitted `storage.storageHash`
   * instead of computing it from content. A pinned hash is not
   * content-derived, so snapshot content verification
   * (`MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH`) rejects any migration
   * snapshot addressed by it — never set this in a real project.
   */
  readonly storageHash?: string;
  readonly foreignKeyDefaults?: ForeignKeyDefaultsState;
  readonly storageTypes?: Record<string, StorageTypeInstance>;
  /**
   * Declared namespace coordinates for this contract — populates
   * `SqlStorage.namespaces` together with `createNamespace`.
   */
  readonly namespaces?: readonly string[];
  /**
   * Authoring warnings collected by the definition producer before the
   * build runs (the PSL interpreter's entity factories run ahead of
   * `buildSqlContractFromDefinition`); seeds the build's single per-build
   * flush. Required key: a producer with nothing collected states
   * `undefined` explicitly.
   */
  readonly warnings: readonly AuthoringWarning[] | undefined;
  /** Target-supplied factory that materialises a `SqlNamespaceBase` concretion for a declared namespace coordinate. */
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  readonly models: readonly ModelNode[];
  readonly valueObjects?: readonly ValueObjectNode[];
  /**
   * Domain enum handles authored via `enumType()`. Each entry lowers to a
   * domain `enum` entry and a storage `valueSet` entry in the contract's
   * default namespace.
   */
  readonly enums?: Record<string, EnumTypeHandle>;
  /**
   * Pack-entity attachments lowered from the `entities` handle list, keyed by
   * namespace then entity kind then name. Each entity lands in
   * `storage.namespaces[ns].entries.<kind>`; when the registered entity-type
   * descriptor's factory output implements the
   * `SqlValueSetDerivingEntityTypeOutput.deriveValueSet` hook, the derived
   * value-set also folds into `entries.valueSet`, mirroring how `enums` flows
   * there. Internal build IR — populated by `buildContractDefinition`, not an
   * author input.
   */
  readonly attachedEntities?: AttachedEntities;
}
