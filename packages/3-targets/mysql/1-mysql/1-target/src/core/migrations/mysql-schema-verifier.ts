import type { Contract } from '@internal/contract/types';
import { SqlSchemaVerifierBase } from '@internal/family-sql/ir';
import type { SchemaDiffIssue, SchemaVerifyOptions } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlSchemaIR } from '@internal/sql-schema-ir/types';

/** The MySQL `SchemaVerifier`. Verification runs through `diffSchema`; these hooks add nothing, as on the other SQL targets. */
export class MysqlSchemaVerifier extends SqlSchemaVerifierBase<Contract<SqlStorage>, SqlSchemaIR> {
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
