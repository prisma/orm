import {
  canonicalizeSchemasForVerification,
  contractToMongoSchemaIR,
  diffMongoSchemas,
} from '@internal/family-mongo/control';
import { MongoSchemaVerifierBase } from '@internal/family-mongo/ir';
import type { SchemaDiffIssue, SchemaVerifyOptions } from '@internal/framework-components/control';
import type { Namespace } from '@internal/framework-components/ir';
import type { MongoSchemaIR } from '@internal/mongo-schema-ir';
import type { MongoTargetContract } from '../mongo-target-contract';

/**
 * Mongo target `SchemaVerifier` concretion. Extends the family base's
 * namespace-walk scaffolding and contributes the per-namespace diff via
 * `verifyNamespace`; the diff body reuses the existing target-side
 * helpers (`contractToMongoSchemaIR`, `canonicalizeSchemasForVerification`,
 * `diffMongoSchemas`) so production verification behaviour is unchanged.
 *
 * Today's invariant: every Mongo contract carries exactly one
 * namespace (the unbound singleton, materialised as
 * `MongoTargetUnboundDatabase`), so the family-base namespace walk
 * dispatches exactly once and the per-namespace body runs the existing
 * whole-schema diff. Future per-collection namespace assignment will
 * have this hook project the diff to the namespace's owned collections.
 *
 * `verifyTargetExtensions` returns the empty list — Mongo has no
 * target-only kinds today.
 *
 * Strict diff mode is `false` for SPI-routed calls; production
 * verification today still goes through `verifyMongoSchema` which
 * receives strict from the CLI.
 */
export class MongoTargetSchemaVerifier extends MongoSchemaVerifierBase<
  MongoTargetContract,
  MongoSchemaIR
> {
  protected verifyNamespace(options: {
    readonly contract: MongoTargetContract;
    readonly schema: MongoSchemaIR;
    readonly namespaceId: string;
    readonly namespace: Namespace;
  }): readonly SchemaDiffIssue[] {
    const expectedIR = contractToMongoSchemaIR(options.contract);
    const { live, expected } = canonicalizeSchemasForVerification(options.schema, expectedIR);
    const collectionControlPolicy = (name: string) =>
      this.collectionControlPolicyForName(options.contract, name);
    const { failures, warnings } = diffMongoSchemas(live, expected, false, collectionControlPolicy);
    return [...failures, ...warnings];
  }

  protected verifyTargetExtensions(
    _options: SchemaVerifyOptions<MongoTargetContract, MongoSchemaIR>,
  ): readonly SchemaDiffIssue[] {
    return [];
  }
}
