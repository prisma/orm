import type {
  SchemaDiffIssue,
  SchemaVerifier,
  SchemaVerifyOptions,
  SchemaVerifyResult,
} from '@internal/framework-components/control';

/**
 * SQL family `SchemaVerifier` abstract base. Centralises the SQL-shared
 * walk (table-by-table + column-by-column matching keyed by
 * `(namespace.id, name)`, FK / unique / index comparisons via the
 * shared satisfaction helpers in `sql-schema-diff.ts`) and exposes a protected hook
 * for target extensions (Postgres functions, RLS policies, future
 * target-only kinds).
 *
 * The base accumulates issues in a single buffer and returns the
 * combined result; the per-SPI family abstract handles the result
 * envelope shape so concrete subclasses focus on target-specific
 * verification logic.
 *
 * The protected hooks (`verifyCommonSqlSchema`,
 * `verifyTargetExtensions`) carry the stable base API that target
 * subclasses (`PostgresSchemaVerifier`, `SqliteSchemaVerifier`)
 * compile against; the SQL-shared walk implementation will be lifted
 * into this base when the verifier behaviour migrates off the
 * legacy adapter shells.
 */
export abstract class SqlSchemaVerifierBase<TContract, TSchema>
  implements SchemaVerifier<TContract, TSchema>
{
  verifySchema(options: SchemaVerifyOptions<TContract, TSchema>): SchemaVerifyResult {
    const issues: SchemaDiffIssue[] = [];
    issues.push(...this.verifyCommonSqlSchema(options));
    issues.push(...this.verifyTargetExtensions(options));
    return { ok: issues.length === 0, issues };
  }

  /**
   * SQL-shared verification — table/column/FK/unique/index walks keyed
   * by `(namespace.id, name)`. Concrete subclasses provide the
   * family-shared implementation today; a future iteration will lift
   * the shared walk into this base.
   */
  protected abstract verifyCommonSqlSchema(
    options: SchemaVerifyOptions<TContract, TSchema>,
  ): readonly SchemaDiffIssue[];

  /**
   * Target-specific extensions — e.g. Postgres functions, future RLS
   * policies, namespace-mismatch issues. Returns the empty list when the
   * target ships no extensions over the SQL family alphabet.
   */
  protected abstract verifyTargetExtensions(
    options: SchemaVerifyOptions<TContract, TSchema>,
  ): readonly SchemaDiffIssue[];
}
