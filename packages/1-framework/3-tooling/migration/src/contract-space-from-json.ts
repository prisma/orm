import { CONTRACT_FORMAT_VERSIONS, readFormatVersion } from '@internal/contract/format-version';
import type { Contract } from '@internal/contract/types';
import type {
  ContractSpace,
  ContractSpaceHeadRef,
  MigrationPackage,
  MigrationPlanOperation,
} from '@internal/framework-components/control';
import { blindCast } from '@internal/utils/casts';
import { errorInvalidManifest, errorInvalidRefFile } from './errors';
import { parseMigrationMetadataDocument } from './formats/migration-metadata/versions';
import { parseRefDocument } from './formats/ref/versions';

/**
 * Materialise a typed {@link ContractSpace} from the JSON artefacts a
 * contract-space extension package emits to disk.
 *
 * Extension descriptors wire `contract.json`, per-migration
 * `migration.json` / `ops.json`, and `refs/head.json` to the framework's
 * typed surfaces. TypeScript widens JSON imports to a structural record
 * that does not preserve readonly modifiers or branded scalars (e.g.
 * `StorageHashBase<'abc123...'>`), so authoring the descriptor inline
 * forces every wiring site to cast through `unknown`. This helper
 * encapsulates the single narrowing point: descriptor sources stay
 * cast-free, and the (necessary) coercion is colocated with the
 * documentation explaining why it is safe.
 *
 * Safety: the JSON files passed here are produced by the framework's own
 * emit pipeline (`prisma contract emit` and `MigrationCLI.run`)
 * and re-validated downstream by the runner / verifier. The descriptor
 * is a pass-through wiring layer — no descriptor consumer treats the
 * narrowed types as a stronger guarantee than "these came from the
 * canonical emit pipeline".
 *
 * These JSON modules are stored files, so each one's format version is
 * read first: a version this release cannot read throws a format version
 * error. Each `migration.json` and the head ref are then read through their
 * format units, which refuse a field they do not know. The contract itself
 * is validated by `family.deserializeContract` (codec-aware, invoked at
 * control-stack construction); the operations are not validated here, as
 * `migration.json`'s version covers them and the runner checks them.
 */
export function contractSpaceFromJson<TContract extends Contract = Contract>(inputs: {
  readonly contractJson: unknown;
  readonly migrations: ReadonlyArray<{
    readonly dirName: string;
    readonly metadata: unknown;
    readonly ops: unknown;
  }>;
  readonly headRef: unknown;
}): ContractSpace<TContract> {
  readFormatVersion(inputs.contractJson, {
    kind: 'contract',
    knownVersions: CONTRACT_FORMAT_VERSIONS,
  });
  const migrations: readonly MigrationPackage[] = inputs.migrations.map((m) => ({
    dirName: m.dirName,
    metadata: bundledMigrationMetadata(m.dirName, m.metadata),
    ops: blindCast<
      readonly MigrationPlanOperation[],
      'the emit pipeline wrote ops.json; the runner validates each operation'
    >(m.ops),
  }));
  return {
    contractJson: blindCast<
      TContract,
      'family.deserializeContract validates the bundled contract at control-stack construction'
    >(inputs.contractJson),
    migrations,
    headRef: bundledHeadRef(inputs.headRef),
  };
}

function bundledMigrationMetadata(dirName: string, document: unknown) {
  const label = `${dirName}/migration.json`;
  const metadata = parseMigrationMetadataDocument(document, undefined);
  if (!metadata.ok) throw errorInvalidManifest(label, metadata.failure);
  return metadata.value;
}

function bundledHeadRef(document: unknown): ContractSpaceHeadRef {
  const content = parseRefDocument(document, undefined);
  if (!content.ok) throw errorInvalidRefFile('refs/head.json', content.failure);
  if (content.value.policies !== undefined) {
    throw errorInvalidRefFile('refs/head.json', 'the head ref declares no policies');
  }
  return { hash: content.value.hash, invariants: content.value.invariants };
}
