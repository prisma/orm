import type { Contract } from '@internal/contract/types';
import { SqlSchemaVerifierBase } from '@internal/family-sql/ir';
import type { SchemaDiffIssue, SchemaVerifyOptions } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';

/**
 * SQLite target `SchemaVerifier` concretion. Mirrors the Postgres
 * shape: hooks return the empty list pending the call-site migration
 * that routes the existing verifier behaviour through the SPI.
 */
export class SqliteSchemaVerifier extends SqlSchemaVerifierBase<Contract<SqlStorage>, SqlSchemaIR> {
  protected verifyCommonSqlSchema(
    _options: SchemaVerifyOptions<Contract<SqlStorage>, SqlSchemaIR>,
  ): readonly SchemaDiffIssue[] {
    return [];
  }

  protected verifyTargetExtensions(
    _options: SchemaVerifyOptions<Contract<SqlStorage>, SqlSchemaIR>,
  ): readonly SchemaDiffIssue[] {
    return [];
  }
}
