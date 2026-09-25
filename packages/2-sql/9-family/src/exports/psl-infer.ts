/**
 * Database→PSL inference utilities for `contract infer`.
 *
 * These leaf transforms (name normalization, relation inference, the printer-config types) carry no
 * dialect knowledge, so they live in the SQL family and are imported by the target that owns the
 * dialect maps and walks its own schema tree (Postgres). The parts `contract print` uses too are
 * under `@internal/family-sql/psl-ast`.
 */

export {
  deriveBackRelationFieldName,
  deriveRelationFieldName,
  pluralize,
  toEnumName,
  toFieldName,
  toModelName,
} from '../core/psl-contract-infer/name-transforms';
export type {
  EnumInfo,
  PslPrinterOptions,
  RelationField,
} from '../core/psl-contract-infer/printer-config';
export type { InferredRelations } from '../core/psl-contract-infer/relation-inference';
export {
  buildChildRelationField,
  inferRelations,
} from '../core/psl-contract-infer/relation-inference';
