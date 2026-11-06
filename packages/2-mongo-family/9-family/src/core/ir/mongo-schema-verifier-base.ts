import type { ControlPolicy } from '@internal/contract/types';
import type {
  SchemaDiffIssue,
  SchemaVerifier,
  SchemaVerifyOptions,
  SchemaVerifyResult,
} from '@internal/framework-components/control';
import type { Namespace } from '@internal/framework-components/ir';
import {
  collectionControlPoliciesOf,
  collectionControlPolicyOf,
  type MongoStorage,
} from '@internal/mongo-contract';

/**
 * Mongo family `SchemaVerifier` abstract base. Commits the Mongo family
 * to namespace-keyed verification: the family-shared walk iterates
 * `storage.namespaces` in sorted order and dispatches per-namespace
 * through the protected `verifyNamespace` hook, then aggregates
 * target-extension issues from `verifyTargetExtensions`.
 *
 * Per-element diff work (collection / index / validator comparisons)
 * lives on the target inside `verifyNamespace`. The family's structural
 * commitment is "verification is namespaced"; the target's commitment is
 * "verification of a given namespace's collections is the existing
 * diff/canonicalize pipeline". The split keeps target-mongo's
 * introspection-side helpers (`contractToMongoSchemaIR`,
 * `canonicalizeSchemasForVerification`, `diffMongoSchemas`) in the target
 * layer where they belong, while the family base owns the iteration
 * scaffolding that makes namespaces a first-class verifier concept.
 *
 * Target-specific issue kinds (Atlas-only, future RLS-equivalents)
 * surface through `verifyTargetExtensions`; that hook returns the empty
 * list when no extensions exist over the Mongo family alphabet.
 */
export abstract class MongoSchemaVerifierBase<
  TContract extends {
    readonly storage: MongoStorage;
    readonly defaultControlPolicy?: ControlPolicy;
  },
  TSchema,
> implements SchemaVerifier<TContract, TSchema>
{
  verifySchema(options: SchemaVerifyOptions<TContract, TSchema>): SchemaVerifyResult {
    const issues: SchemaDiffIssue[] = [];
    issues.push(...this.verifyCommonMongoSchema(options));
    issues.push(...this.verifyTargetExtensions(options));
    return { ok: issues.length === 0, issues };
  }

  protected collectionControlPolicyForName(
    contract: TContract,
    collectionName: string,
  ): ControlPolicy {
    return collectionControlPolicyOf(collectionName, collectionControlPoliciesOf(contract));
  }

  protected verifyCommonMongoSchema(
    options: SchemaVerifyOptions<TContract, TSchema>,
  ): readonly SchemaDiffIssue[] {
    const issues: SchemaDiffIssue[] = [];
    const { namespaces } = options.contract.storage;
    const namespaceIds = Object.keys(namespaces).sort();
    for (const namespaceId of namespaceIds) {
      const namespace = namespaces[namespaceId];
      if (!namespace) continue;
      issues.push(
        ...this.verifyNamespace({
          contract: options.contract,
          schema: options.schema,
          namespaceId,
          namespace,
        }),
      );
    }
    return issues;
  }

  /**
   * Per-namespace verification hook. Receives the namespace metadata plus
   * the full contract + schema pair; the target's implementation owns the
   * per-collection diff using its existing introspection-side helpers.
   * Slice the schema by namespace at the call site (or compute the full
   * diff once and dispatch per namespace) — the family base does not
   * prescribe the per-namespace shape.
   */
  protected abstract verifyNamespace(options: {
    readonly contract: TContract;
    readonly schema: TSchema;
    readonly namespaceId: string;
    readonly namespace: Namespace;
  }): readonly SchemaDiffIssue[];

  /**
   * Target-specific extensions — Atlas-only kinds, target-only
   * namespace-mismatch issues that don't fit the family-shared walk.
   * Returns the empty list when the target ships no extensions.
   */
  protected abstract verifyTargetExtensions(
    options: SchemaVerifyOptions<TContract, TSchema>,
  ): readonly SchemaDiffIssue[];
}
