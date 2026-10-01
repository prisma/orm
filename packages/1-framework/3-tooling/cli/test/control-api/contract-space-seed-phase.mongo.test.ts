import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { coreHash, profileHash } from '@internal/contract/types';
import {
  contractSnapshotDir,
  readContractSnapshotJson,
} from '@internal/migration-tools/contract-snapshot-store';
import {
  listContractSpaceDirectories,
  readContractSpaceHeadRef,
} from '@internal/migration-tools/spaces';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runContractSpaceSeedPhase } from '../../src/control-api/operations/contract-space-seed-phase';

/**
 * The framework's extension-space seed phase and the aggregate-loader
 * pinned-contract read helpers are family-neutral; this file pins the
 * property that they accept a Mongo-shaped contract cleanly.
 *
 * The seed phase canonicalises any `unknown` contract value to JSON
 * via `emitContractSpaceArtifacts`, and the `.d.ts` it emits is a
 * framework-wide placeholder stub (a typed `.d.ts` renderer for
 * extension contracts is a separately-tracked concern). The
 * Mongo-shape input here is structural; no Mongo-family runtime
 * imports are required.
 *
 * The companion SQL-shape test in this directory
 * (`contract-space-seed-phase.test.ts`) covers the same harness with a
 * smaller `{ v: 1 }` value; this file adds Mongo coverage so a future
 * shape regression in `MongoContract.storage` or in canonicalisation
 * is caught here.
 *
 * Coverage:
 * - A Mongo aggregate with one extension descriptor writes the head
 *   contract into the migrations-root snapshot store (`snapshots/<hex>/`)
 *   plus `refs/head.json` — no per-space `contract.json` / `contract.d.ts`.
 * - `readContractSnapshotJson`, the store's `contract.d.ts`,
 *   `readContractSpaceHeadRef`, `listContractSpaceDirectories` round-trip
 *   the written values.
 * - Re-running the seed phase with no contract change produces
 *   byte-identical artifacts.
 */

const EXT_SPACE = 'cipherstash';

interface MongoShapedExtensionContract {
  readonly target: 'mongo';
  readonly targetFamily: 'mongo';
  readonly roots: Record<string, never>;
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: {
        readonly models: Record<string, never>;
      };
    };
  };
  readonly storage: {
    readonly namespaces: {
      readonly __unbound__: {
        readonly id: '__unbound__';
        readonly kind: 'mongo-namespace';
        readonly entries: {
          readonly collection: Record<
            string,
            {
              readonly indexes: ReadonlyArray<{
                readonly keys: ReadonlyArray<{
                  readonly field: string;
                  readonly direction: 1 | -1;
                }>;
                readonly unique?: boolean;
              }>;
            }
          >;
        };
      };
    };
    readonly storageHash: string;
  };
  readonly capabilities: Record<string, never>;
  readonly extensions: Record<string, never>;
  readonly profileHash: string;
  readonly meta: Record<string, never>;
}

function buildMongoExtensionContract(): MongoShapedExtensionContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: {},
    domain: { namespaces: { __unbound__: { models: {} } } },
    storage: {
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: {
            collection: {
              cipherstash_state: {
                indexes: [{ keys: [{ field: 'tenantId', direction: 1 }], unique: true }],
              },
            },
          },
        },
      },
      storageHash: coreHash('e'.repeat(64)),
    },
    capabilities: {},
    extensions: {},
    profileHash: profileHash('mongo-ext-profile'),
    meta: {},
  };
}

describe('runContractSpaceSeedPhase (Mongo-shaped contract)', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'cli-cs-seed-mongo-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('writes contract.json, contract.d.ts and refs/head.json for a Mongo extension; loader helpers round-trip', async () => {
    const contract = buildMongoExtensionContract();
    const headHash = contract.storage.storageHash;
    const invariants = ['inv:b', 'inv:a'] as const;

    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensions: [
        {
          id: EXT_SPACE,
          contractSpace: {
            contractJson: contract,
            headRef: { hash: headHash, invariants },
            migrations: [],
          },
        },
      ],
    });

    expect(out.seeded).toHaveLength(1);
    const record = out.seeded[0]!;
    expect(record).toMatchObject({
      spaceId: EXT_SPACE,
      action: 'updated',
      priorHash: null,
      newHash: headHash,
    });

    const dirs = await listContractSpaceDirectories(migrationsDir);
    expect(dirs).toContain(EXT_SPACE);

    // The space directory carries only refs/ — no per-space contract.json
    // / contract.d.ts siblings.
    await expect(stat(join(migrationsDir, EXT_SPACE, 'contract.json'))).rejects.toThrow();
    await expect(stat(join(migrationsDir, EXT_SPACE, 'contract.d.ts'))).rejects.toThrow();

    // Store entry: canonicalised value round-trips back to the structural
    // shape we handed in (storage, models, ...). The deep equality bound
    // enforces that canonicalisation preserves every Mongo-specific field
    // — a future canonicaliser that drops or reshapes Mongo storage would
    // turn this test red.
    const loadedContract = await readContractSnapshotJson(migrationsDir, headHash);
    expect(loadedContract).toEqual(contract);

    // contract.d.ts: framework-wide placeholder stub. Asserts the
    // property a future typed-`.d.ts` renderer would change
    // deliberately.
    const dtsRaw = await readFile(
      join(contractSnapshotDir(migrationsDir, headHash), 'contract.d.ts'),
      'utf-8',
    );
    expect(dtsRaw).toContain('export {};');
    expect(dtsRaw).toContain(EXT_SPACE);
    expect(dtsRaw).not.toContain('@ts-nocheck');

    // refs/head.json: hash + invariants (alphabetically sorted by the
    // framework — the input order was reversed).
    const headRef = await readContractSpaceHeadRef(migrationsDir, EXT_SPACE);
    expect(headRef).not.toBeNull();
    expect(headRef).toMatchObject({
      hash: headHash,
      invariants: ['inv:a', 'inv:b'],
    });
  });

  it('re-emits byte-identical artifacts on a no-op re-seed', async () => {
    const contract = buildMongoExtensionContract();
    const headHash = contract.storage.storageHash;
    const invariants = ['inv:a', 'inv:b'] as const;

    const seedInput = {
      migrationsDir,
      extensions: [
        {
          id: EXT_SPACE,
          contractSpace: {
            contractJson: contract,
            headRef: { hash: headHash, invariants },
            migrations: [],
          },
        },
      ],
    };

    await runContractSpaceSeedPhase(seedInput);

    const snapshotDir = contractSnapshotDir(migrationsDir, headHash);
    const firstContract = await readFile(join(snapshotDir, 'contract.json'));
    const firstDts = await readFile(join(snapshotDir, 'contract.d.ts'));
    const firstHead = await readFile(join(migrationsDir, EXT_SPACE, 'refs', 'head.json'));

    const second = await runContractSpaceSeedPhase(seedInput);
    expect(second.seeded[0]!.action).toBe('unchanged');

    expect(await readFile(join(snapshotDir, 'contract.json'))).toEqual(firstContract);
    expect(await readFile(join(snapshotDir, 'contract.d.ts'))).toEqual(firstDts);
    expect(await readFile(join(migrationsDir, EXT_SPACE, 'refs', 'head.json'))).toEqual(firstHead);
  });
});
