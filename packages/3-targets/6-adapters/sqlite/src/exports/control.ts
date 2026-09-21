import type { SqlControlAdapterDescriptor } from '@internal/family-sql/control';
import type { SqlControlAdapter } from '@internal/family-sql/control-adapter';
import { assembleSqliteCodecRegistry } from '../core/codec-lookup';
import { SqliteControlAdapter } from '../core/control-adapter';
import {
  createSqliteDefaultFunctionRegistry,
  createSqliteDefaultLiteralTagRegistry,
  createSqliteMutationDefaultGeneratorDescriptors,
  sqliteScalarAuthoringTypes,
} from '../core/control-mutation-defaults';
import { sqliteAdapterDescriptorMeta } from '../core/descriptor-meta';

const sqliteAdapterDescriptor: SqlControlAdapterDescriptor<'sqlite'> = {
  ...sqliteAdapterDescriptorMeta,
  authoring: { type: sqliteScalarAuthoringTypes, valueObjectStorageType: 'Json' },
  controlMutationDefaults: {
    defaultFunctionRegistry: createSqliteDefaultFunctionRegistry(),
    defaultLiteralTagRegistry: createSqliteDefaultLiteralTagRegistry(),
    generatorDescriptors: createSqliteMutationDefaultGeneratorDescriptors(),
  },
  create(stack): SqlControlAdapter<'sqlite'> {
    const codecRegistry = assembleSqliteCodecRegistry(stack.target, stack.extensions);
    return new SqliteControlAdapter(codecRegistry);
  },
};

export default sqliteAdapterDescriptor;

// `parseSqliteDefault`, `normalizeSqliteNativeType`, `quoteIdentifier`,
// and `escapeLiteral` live target-side (one-way `adapter → target` edge,
// matching Postgres). Re-exported from the adapter so consumers — both
// internal and downstream — see the same adapter-shaped surface across
// SQL targets.
export { parseSqliteDefault } from '@internal/target-sqlite/default-normalizer';
export { normalizeSqliteNativeType } from '@internal/target-sqlite/native-type-normalizer';
export { escapeLiteral, quoteIdentifier } from '@internal/target-sqlite/sql-utils';
export {
  createSqliteBuiltinCodecLookup,
  createSqliteCodecRegistryWithBuiltins,
} from '../core/codec-lookup';
// `SqlControlAdapterDescriptor` is declared in two places in the codebase
// (`family-sql/control-adapter` and `family-sql/migrations/types`); the
// migrations-side declaration narrows `create()`'s return type to the base
// `ControlAdapterInstance`, hiding `introspect`/`readMarker`. Until that's
// reconciled upstream, downstream consumers (e2e harness, integration
// tests) need direct access to the concrete class. Mirrors how Postgres'
// own package tests import `PostgresControlAdapter` directly.
export { SqliteControlAdapter } from '../core/control-adapter';
