import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { canonicalizeJson } from '@internal/framework-components/utils';
import { join } from 'pathe';
import { writeContractSnapshot } from './contract-snapshot-store';
import type { ContractSpaceHeadRef } from './read-contract-space-head-ref';
import { assertValidSpaceId, spaceRefsDirectory } from './space-layout';

/**
 * Inputs for {@link emitContractSpaceArtifacts}.
 *
 * - `contract` is the canonical contract value the framework just emitted
 *   for the space; it is serialised through {@link canonicalizeJson}, so
 *   it must be a JSON-compatible value (objects / arrays / primitives).
 *   Typed as `unknown` rather than the SQL-family `Contract<SqlStorage>`
 *   to keep `migration-tools` framework-neutral; SQL-family callers pass
 *   their typed value through unchanged.
 *
 * - `contractDts` is the pre-rendered `.d.ts` text. Rendering happens in
 *   the SQL family (which owns the codec / typemap input the renderer
 *   needs), so this helper accepts the text verbatim and writes it out
 *   without further transformation.
 *
 * - `headRef` is the head reference for the space.
 *   `invariants` are sorted alphabetically before serialisation so two
 *   callers passing the same set in different orders produce
 *   byte-identical `refs/head.json`.
 */
export interface ContractSpaceArtifactInputs {
  readonly contract: unknown;
  readonly contractDts: string;
  readonly headRef: ContractSpaceHeadRef;
}

/**
 * Emit the per-space artifacts — the head contract snapshot (written into
 * the migrations-root-wide `snapshots/` store, keyed by `headRef.hash`) and
 * `refs/head.json` — under `<projectMigrationsDir>/<spaceId>/`.
 *
 * The head contract snapshot is write-if-absent (see
 * {@link writeContractSnapshot}): a changed extension contract has a new
 * hash, so it lands as a new store entry; an unchanged hash means identical
 * canonical content already sits there. `refs/head.json` is
 * rewritten whenever the head it holds differs; a file that already holds the
 * same head, however it is formatted, is left alone.
 *
 * Path layout matches the convention in
 * [`spaceMigrationDirectory`](./space-layout.ts). The space id is
 * validated against `[a-z][a-z0-9_-]{0,63}` via
 * {@link assertValidSpaceId} for filesystem-safety reasons; the helper
 * accepts every space uniformly (including the app space, default
 * `'app'`).
 *
 * The migrations directory and space subdirectory are created if they
 * do not yet exist (`mkdir { recursive: true }`).
 *
 * Returns the snapshot directory and the head ref path when this call wrote them.
 */
export async function emitContractSpaceArtifacts(
  projectMigrationsDir: string,
  spaceId: string,
  inputs: ContractSpaceArtifactInputs,
): Promise<{ readonly writtenPaths: readonly string[] }> {
  assertValidSpaceId(spaceId);

  const dir = join(projectMigrationsDir, spaceId);
  const refsDir = spaceRefsDirectory(dir);
  await mkdir(refsDir, { recursive: true });

  const writtenPaths: string[] = [];
  const snapshot = await writeContractSnapshot(projectMigrationsDir, inputs.headRef.hash, {
    contractJson: inputs.contract,
    contractDts: inputs.contractDts,
  });
  if (snapshot.written) writtenPaths.push(snapshot.dir);

  const sortedInvariants = [...inputs.headRef.invariants].sort();
  const headJson = canonicalizeJson({
    hash: inputs.headRef.hash,
    invariants: sortedInvariants,
  });
  const headPath = join(refsDir, 'head.json');
  if ((await canonicalHeadOnDisk(headPath)) !== headJson) {
    await writeFile(headPath, `${headJson}\n`);
    writtenPaths.push(headPath);
  }
  return { writtenPaths };
}

async function canonicalHeadOnDisk(headPath: string): Promise<string | undefined> {
  try {
    const onDisk: { hash?: unknown; invariants?: unknown } = JSON.parse(
      await readFile(headPath, 'utf-8'),
    );
    if (!Array.isArray(onDisk.invariants)) return undefined;
    return canonicalizeJson({ hash: onDisk.hash, invariants: [...onDisk.invariants].sort() });
  } catch {
    return undefined;
  }
}
