/**
 * SQL Schema IR types for target-agnostic schema representation.
 *
 * These classes represent the canonical in-memory representation of
 * SQL schemas for the SQL family, used for verification and migration
 * planning. Each class extends `SqlSchemaIRNode` (the family base
 * declared in `ir/sql-schema-ir-node.ts`) and carries `freezeNode`
 * sealing in its constructor. `Input` interfaces describe the
 * plain-data shape that introspection adapters produce.
 */

export {
  contractDefaultRefusal,
  type DefaultInCanonicalForm,
  defaultInCanonicalForm,
} from './ir/default-in-canonical-form';
export { PrimaryKey, type PrimaryKeyInput } from './ir/primary-key';
export {
  RelationalSchemaNodeKind,
  relationalNodeEntityKind,
  relationalNodeGranularity,
} from './ir/schema-node-kinds';
export {
  SqlCheckConstraintIR,
  type SqlCheckConstraintIRInput,
} from './ir/sql-check-constraint-ir';
export {
  SqlColumnDefaultIR,
  type SqlColumnDefaultIRInput,
} from './ir/sql-column-default-ir';
export {
  type SqlAnnotations,
  SqlColumnIR,
  type SqlColumnIRInput,
} from './ir/sql-column-ir';
export {
  SqlForeignKeyIR,
  type SqlForeignKeyIRInput,
  type SqlReferentialAction,
} from './ir/sql-foreign-key-ir';
export {
  SqlIndexIR,
  type SqlIndexIRInput,
} from './ir/sql-index-ir';
export { SqlSchemaIR, type SqlSchemaIRInput } from './ir/sql-schema-ir';
export { assertNode, defineNonEnumerable, SqlSchemaIRNode } from './ir/sql-schema-ir-node';
export { SqlTableIR, type SqlTableIRInput } from './ir/sql-table-ir';
export { SqlUniqueIR, type SqlUniqueIRInput } from './ir/sql-unique-ir';
