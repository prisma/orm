/**
 * Plans every committed SQL contract from an empty database and compares the planner's output with
 * the output recorded for it. A change in the DDL either planner writes fails here.
 *
 * A contract is any file `trackedContractCandidateFiles` lists whose top level names the SQL family
 * and the Postgres or SQLite target, whatever the file is called.
 *
 * A contract in a format today's validator refuses (old migration snapshots), or one the planner
 * refuses with a structured error, cannot be planned; its recording holds the refusal instead.
 * Extension packs that live inside an example and cannot be imported here are listed under
 * `extensionsNotLoaded`.
 *
 * `manifest.json` holds, for each contract, the SHA-256 of its recording: the exact text
 * `JSON.stringify(recording, null, 2)` plus a newline. The two fixture contracts also keep their
 * full recording in `fixtures/<target>/planned.golden.json`.
 *
 * On a mismatch the test names the contract, prints the output it computed and writes it to
 * `wip/planner-golden/` at the repository root. To see the output of the base commit, check out
 * that commit and run
 * `PLANNER_GOLDEN_WRITE=1 pnpm --filter integration-tests test test/planner-golden`: it rewrites
 * the manifest and the two fixture recordings, and writes every contract's full recording to
 * `wip/planner-golden/` for diffing.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import postgresAdapterControl from '@internal/adapter-postgres/control';
import sqliteAdapterControl from '@internal/adapter-sqlite/control';
import { ContractValidationError } from '@internal/contract/contract-validation-error';
import postgresDriverControl from '@internal/driver-postgres/control';
import sqliteDriverControl from '@internal/driver-sqlite/control';
import arktypeJson from '@internal/extension-arktype-json/control';
import paradedb from '@internal/extension-paradedb/control';
import pgvector from '@internal/extension-pgvector/control';
import postgis from '@internal/extension-postgis/control';
import supabase from '@internal/extension-supabase/pack';
import sqlFamilyControl, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import postgresTargetControl from '@internal/target-postgres/control';
import { PostgresDatabaseSchemaNode } from '@internal/target-postgres/types';
import sqliteTargetControl from '@internal/target-sqlite/control';
import { isStructuredError } from '@internal/utils/structured-error';
import { join, relative, resolve } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import { trackedContractCandidateFiles } from '../utils/tracked-contract-files';

const writeRecordings = process.env['PLANNER_GOLDEN_WRITE'] === '1';
const repoRoot = resolve(import.meta.dirname, '../../../..');
const manifestPath = join(import.meta.dirname, 'manifest.json');
const recordedDir = join(repoRoot, 'wip/planner-golden');

const fixtureRecordings: ReadonlyMap<string, string> = new Map(
  (['postgres', 'sqlite'] as const).map((target) => [
    relative(repoRoot, join(import.meta.dirname, 'fixtures', target, 'generated/contract.json')),
    join(import.meta.dirname, 'fixtures', target, 'planned.golden.json'),
  ]),
);

type SqlExtension = ControlExtensionDescriptor<'sql', 'postgres'>;

const extensionsById: Readonly<Record<string, SqlExtension>> = {
  'arktype-json': arktypeJson,
  paradedb,
  pgvector,
  postgis,
  supabase,
};

const examplePackIds: ReadonlySet<string> = new Set([
  'audit',
  'demo/engagement-stats',
  'feature-flags',
  'slugid-defaults',
]);

interface CommittedContract {
  readonly path: string;
  readonly target: 'postgres' | 'sqlite';
  readonly extensionIds: readonly string[];
  readonly json: unknown;
}

function parseJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));
  } catch {
    return undefined;
  }
}

function listCommittedSqlContracts(): readonly CommittedContract[] {
  const contracts: CommittedContract[] = [];
  for (const path of trackedContractCandidateFiles(repoRoot)) {
    const json = parseJson(path);
    if (typeof json !== 'object' || json === null) continue;
    const { target, targetFamily, extensions } = json as {
      target?: unknown;
      targetFamily?: unknown;
      extensions?: unknown;
    };
    if (targetFamily !== 'sql' || (target !== 'postgres' && target !== 'sqlite')) continue;
    const extensionIds =
      typeof extensions === 'object' && extensions !== null ? Object.keys(extensions).sort() : [];
    contracts.push({ path, target, extensionIds, json });
  }
  return contracts;
}

function recordedNameOf(path: string): string {
  return `${path.replaceAll('/', '__')}.golden.json`;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function readManifest(): Readonly<Record<string, string>> {
  return existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>)
    : {};
}

function writeRecorded(path: string, rendered: string): string {
  mkdirSync(recordedDir, { recursive: true });
  const recordedPath = join(recordedDir, recordedNameOf(path));
  writeFileSync(recordedPath, rendered);
  return recordedPath;
}

const emptyPostgresSchema = new PostgresDatabaseSchemaNode({
  namespaces: {},
  roles: [],
  existingSchemas: ['public'],
  pgVersion: 'unknown',
});

const emptySqliteSchema = new SqlSchemaIR({ tables: {} });

function readContract(
  family: { deserializeContract(json: unknown): unknown },
  json: unknown,
): { readonly contract: unknown } | { readonly unreadable: unknown } {
  try {
    return { contract: family.deserializeContract(json) };
  } catch (error) {
    if (error instanceof ContractValidationError) {
      return { unreadable: { kind: 'unreadable', phase: error.phase, message: error.message } };
    }
    throw error;
  }
}

function extensionsOf(contract: CommittedContract): {
  readonly loaded: readonly SqlExtension[];
  readonly notLoaded: readonly string[];
} {
  const loaded: SqlExtension[] = [];
  const notLoaded: string[] = [];
  for (const id of contract.extensionIds) {
    const extension = extensionsById[id];
    if (extension !== undefined) {
      loaded.push(extension);
    } else if (examplePackIds.has(id)) {
      notLoaded.push(id);
    } else {
      throw new Error(
        `${contract.path} uses the extension pack "${id}", which this test neither loads nor lists as an example pack.`,
      );
    }
  }
  return { loaded, notLoaded };
}

async function plannerErrorOr(plan: () => Promise<unknown>): Promise<unknown> {
  try {
    return await plan();
  } catch (error) {
    if (!isStructuredError(error)) throw error;
    return { kind: 'plannerError', code: error.code, message: error.message };
  }
}

async function planFromEmpty(
  contract: CommittedContract,
  extensions: readonly SqlExtension[],
): Promise<unknown> {
  if (contract.target === 'postgres') {
    const stack = createControlStack({
      family: sqlFamilyControl,
      target: postgresTargetControl,
      adapter: postgresAdapterControl,
      driver: postgresDriverControl,
      extensions,
    });
    const family = sqlFamilyControl.create(stack);
    const read = readContract(family, contract.json);
    if ('unreadable' in read) return read.unreadable;
    const adapter = postgresAdapterControl.create(stack);
    const planner = postgresTargetControl.migrations.createPlanner(adapter);
    return plannerErrorOr(async () => {
      const result = planner.plan({
        contract: read.contract,
        schema: emptyPostgresSchema,
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        frameworkComponents: [
          postgresTargetControl,
          postgresAdapterControl,
          postgresDriverControl,
          ...extensions,
        ],
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });
      if (result.kind !== 'success') return result;
      return { kind: result.kind, operations: await Promise.all(result.plan.operations) };
    });
  }
  const stack = createControlStack({
    family: sqlFamilyControl,
    target: sqliteTargetControl,
    adapter: sqliteAdapterControl,
    driver: sqliteDriverControl,
    extensions: [],
  });
  const family = sqlFamilyControl.create(stack);
  const read = readContract(family, contract.json);
  if ('unreadable' in read) return read.unreadable;
  const adapter = sqliteAdapterControl.create(stack);
  const planner = sqliteTargetControl.migrations.createPlanner(adapter);
  return plannerErrorOr(async () => {
    const result = planner.plan({
      contract: read.contract,
      schema: emptySqliteSchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [sqliteTargetControl, sqliteAdapterControl, sqliteDriverControl],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') return result;
    return { kind: result.kind, operations: await Promise.all(result.plan.operations) };
  });
}

const contracts = listCommittedSqlContracts();
const manifest = readManifest();
const computedHashes = new Map<string, string>();

describe('planner DDL goldens', () => {
  afterAll(() => {
    if (!writeRecordings) return;
    const paths = contracts.map((contract) => contract.path).sort();
    const written = Object.fromEntries(
      paths.flatMap((path) => {
        const hash = computedHashes.get(path) ?? manifest[path];
        return hash === undefined ? [] : [[path, hash]];
      }),
    );
    writeFileSync(manifestPath, `${JSON.stringify(written, null, 2)}\n`);
  });

  it('covers at least one Postgres and one SQLite contract', () => {
    expect(contracts.some((contract) => contract.target === 'postgres')).toBe(true);
    expect(contracts.some((contract) => contract.target === 'sqlite')).toBe(true);
  });

  it('records exactly the committed contracts in the manifest', () => {
    if (writeRecordings) return;
    expect(Object.keys(manifest)).toEqual(contracts.map((contract) => contract.path).sort());
  });

  it('has a full recording for each fixture contract', () => {
    const paths = new Set(contracts.map((contract) => contract.path));
    expect([...fixtureRecordings.keys()].filter((path) => !paths.has(path))).toEqual([]);
  });

  it.each(contracts.map((contract) => [contract.path, contract] as const))(
    'plans %s from an empty database as recorded',
    async (path, contract) => {
      const { loaded, notLoaded } = extensionsOf(contract);
      const planned = await planFromEmpty(contract, loaded);
      const rendered = `${JSON.stringify(
        {
          contract: contract.path,
          target: contract.target,
          extensions: contract.extensionIds.filter((id) => !notLoaded.includes(id)),
          ...(notLoaded.length > 0 ? { extensionsNotLoaded: notLoaded } : {}),
          planned,
        },
        null,
        2,
      )}\n`;
      const hash = sha256(rendered);
      const fixtureRecording = fixtureRecordings.get(path);
      if (writeRecordings) {
        computedHashes.set(path, hash);
        writeRecorded(path, rendered);
        if (fixtureRecording !== undefined) writeFileSync(fixtureRecording, rendered);
        return;
      }
      if (fixtureRecording !== undefined) {
        expect(rendered).toBe(readFileSync(fixtureRecording, 'utf8'));
      }
      if (hash !== manifest[path]) {
        const recordedPath = writeRecorded(path, rendered);
        expect.fail(
          `The planner output for ${path} does not match manifest.json. It is written to ${recordedPath}:\n${rendered}`,
        );
      }
    },
  );
});
