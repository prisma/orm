import type { Contract } from '@internal/contract/types';
import { SqlSchemaVerifierBase } from '@internal/family-sql/ir';
import type { SchemaDiffIssue, SchemaVerifyOptions } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';

/**
 * Postgres target `SchemaVerifier` concretion. Plugs into the
 * SQL-shared verification surface; production verification today still
 * routes through the family verify verdict (`verifySqlSchemaByDiff` over
 * `diffPostgresSchema`), which carries options (codec hooks,
 * normalizers, framework components) that the framework-level
 * `SchemaVerifyOptions` shape does not yet surface.
 *
 * The hooks return the empty list pending the call-site migration that
 * routes the existing verifier behaviour through the SPI — at that
 * point `verifyCommonSqlSchema` will likely lift onto the family base
 * (mirroring `verifyCommonMongoSchema`) and `verifyTargetExtensions`
 * will house Postgres-only kinds (functions, RLS policies in a future
 * project).
 */
export class PostgresSchemaVerifier extends SqlSchemaVerifierBase<
  Contract<SqlStorage>,
  SqlSchemaIR
> {
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
