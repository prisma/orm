import type { ControlTargetDescriptor } from './control-descriptors';
import type { ControlFamilyInstance } from './control-instances';
import type { MigrationPlanOperation, TargetMigrationsCapability } from './control-migration-types';
import type { OperationPreview } from './control-operation-preview';
import type { CoreSchemaView } from './control-schema-view';
import type { PslDocumentAst } from './psl-ast';
import type { SchemaDiffIssue } from './schema-diff';

export interface MigratableTargetDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TFamilyInstance extends ControlFamilyInstance<TFamilyId, unknown> = ControlFamilyInstance<
    TFamilyId,
    unknown
  >,
> extends ControlTargetDescriptor<TFamilyId, TTargetId> {
  readonly migrations: TargetMigrationsCapability<TFamilyId, TTargetId, TFamilyInstance>;
}

export function hasMigrations<TFamilyId extends string, TTargetId extends string>(
  target: ControlTargetDescriptor<TFamilyId, TTargetId>,
): target is MigratableTargetDescriptor<TFamilyId, TTargetId> {
  return 'migrations' in target && !!(target as Record<string, unknown>)['migrations'];
}

export interface SchemaViewCapable<TSchemaIR = unknown> {
  toSchemaView(schema: TSchemaIR): CoreSchemaView;
}

export function hasSchemaView<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & SchemaViewCapable<TSchemaIR> {
  return (
    'toSchemaView' in instance &&
    typeof (instance as Record<string, unknown>)['toSchemaView'] === 'function'
  );
}

/**
 * Capability declaring that a family can infer a PSL contract AST from its
 * opaque introspected schema IR. Consumed by `prisma contract infer`.
 */
export interface PslContractInferCapable<TSchemaIR = unknown> {
  inferPslContract(schemaIR: TSchemaIR): PslDocumentAst;
}

export function hasPslContractInfer<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & PslContractInferCapable<TSchemaIR> {
  return (
    'inferPslContract' in instance &&
    typeof (instance as Record<string, unknown>)['inferPslContract'] === 'function'
  );
}

/**
 * Capability declaring that a family can print a loaded contract as a PSL
 * document AST in the current dialect. Consumed by `prisma contract convert`.
 */
export interface PslContractPrintCapable<TContract = unknown> {
  printPslContract(contract: TContract): PslDocumentAst;
}

export function hasPslContractPrint<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & PslContractPrintCapable {
  return typeof Reflect.get(instance, 'printPslContract') === 'function';
}

/**
 * Capability declaring that a family can render a textual preview of migration
 * operations for the CLI's "DDL preview" output. SQL families emit
 * `language: 'sql'` statements; Mongo families emit `language: 'mongodb-shell'`.
 */
export interface OperationPreviewCapable {
  toOperationPreview(operations: readonly MigrationPlanOperation[]): OperationPreview;
}

export function hasOperationPreview<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & OperationPreviewCapable {
  return (
    'toOperationPreview' in instance &&
    typeof (instance as Record<string, unknown>)['toOperationPreview'] === 'function'
  );
}

/**
 * The granularity of a {@link SchemaDiffIssue}'s subject, resolved on demand
 * from the issue's node `nodeKind` — never stamped on the issue or the node.
 *
 * - `namespace`: a whole namespace.
 * - `entity`: a whole top-level entity (the thing a namespace contains).
 * - `field`: a field of an entity.
 * - `auxiliary`: a secondary part of an entity (an index, a default, a key).
 * - `structural`: a cross-cutting object (an access policy, a tree root) that
 *   is the owning space's own concern, never a sibling's unclaimed entity —
 *   its extras fail verify in both modes.
 */
export type DiffSubjectGranularity = 'namespace' | 'entity' | 'field' | 'auxiliary' | 'structural';

/**
 * Capability declaring that a family can classify a {@link SchemaDiffIssue}'s
 * subject granularity, and separately its storage `entityKind`, on demand —
 * both resolved from its node's `nodeKind` through the family/target
 * vocabulary it owns. Consumed by framework code that spans contract spaces
 * (the migration aggregate's unclaimed-elements sweep) and cannot itself read
 * family/target node vocabulary, so it asks this capability instead of
 * hardcoding a family entity kind. `undefined` when the issue's node kind is
 * unrecognized, or when the family injects no classifier at all — callers
 * fall back to path shape in that case.
 *
 * `classifyEntityKind` returns the same per-family vocabulary as the contract
 * storage's `entries` dictionary keys (the vocabulary
 * {@link import('../ir/storage').elementCoordinates} walks) — never a
 * granularity word, and never a word this framework layer names itself.
 */
export interface SchemaSubjectClassifierCapable {
  classifySubjectGranularity(issue: SchemaDiffIssue): DiffSubjectGranularity | undefined;
  classifyEntityKind(issue: SchemaDiffIssue): string | undefined;
}

export function hasSchemaSubjectClassifier<TFamilyId extends string, TSchemaIR>(
  instance: ControlFamilyInstance<TFamilyId, TSchemaIR>,
): instance is ControlFamilyInstance<TFamilyId, TSchemaIR> & SchemaSubjectClassifierCapable {
  return (
    'classifySubjectGranularity' in instance &&
    typeof (instance as Record<string, unknown>)['classifySubjectGranularity'] === 'function' &&
    'classifyEntityKind' in instance &&
    typeof (instance as Record<string, unknown>)['classifyEntityKind'] === 'function'
  );
}
