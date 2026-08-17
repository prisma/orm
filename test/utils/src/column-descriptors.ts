/**
 * Adapter-agnostic column type descriptors for test fixtures.
 *
 * These descriptors match common PostgreSQL types but don't depend on
 * @internal/adapter-postgres or any target-specific packages. Use these in test fixtures to avoid adapter/target dependencies.
 *
 * The shape matches `ColumnTypeDescriptor` from `@internal/framework-components/codec` but is defined locally to keep test-utils dependency-free (`framework-components` transitively depends on packages that devDepend on test-utils, so a runtime dep here would create a turbo build cycle).
 */
type ColumnTypeDescriptor = {
  readonly codecId: string;
  readonly nativeType: string;
};

export const int4Column: ColumnTypeDescriptor = {
  codecId: 'pg/int4@1',
  nativeType: 'int4',
} as const;

export const textColumn: ColumnTypeDescriptor = {
  codecId: 'pg/text@1',
  nativeType: 'text',
} as const;

export const boolColumn: ColumnTypeDescriptor = {
  codecId: 'pg/bool@1',
  nativeType: 'bool',
} as const;

export const int2Column: ColumnTypeDescriptor = {
  codecId: 'pg/int2@1',
  nativeType: 'int2',
} as const;

export const int8Column: ColumnTypeDescriptor = {
  codecId: 'pg/int8@1',
  nativeType: 'int8',
} as const;

export const float4Column: ColumnTypeDescriptor = {
  codecId: 'pg/float4@1',
  nativeType: 'float4',
} as const;

export const float8Column: ColumnTypeDescriptor = {
  codecId: 'pg/float8@1',
  nativeType: 'float8',
} as const;

export const timestampColumn: ColumnTypeDescriptor = {
  codecId: 'pg/timestamp-temporal@1',
  nativeType: 'timestamp',
} as const;

export const timestamptzColumn: ColumnTypeDescriptor = {
  codecId: 'pg/timestamptz-temporal@1',
  nativeType: 'timestamptz',
} as const;
