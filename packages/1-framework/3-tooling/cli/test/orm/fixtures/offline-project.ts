import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { deriveProvidedInvariants } from '@internal/migration-tools/invariants';
import { writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeRef } from '@internal/migration-tools/refs';
import { blindCast } from '@internal/utils/casts';
import { ok } from '@internal/utils/result';
import { join } from 'pathe';
import { type Mock, vi } from 'vitest';
import type { ControlClient } from '../../../src/control-api/types';
import { createBinCommands } from '../../../src/orm/cli';
import { createTestProjectDir } from '../../utils/test-project-dir';

/**
 * A project on disk for the offline write commands: an emitted contract.json
 * (its declarations are rendered by the control client, never read from disk),
 * a manifest so the import-root resolver has one deterministic answer, and a
 * config whose descriptors are structural stand-ins. No module mocks — the
 * commands run the real operation layer against real files.
 */
export interface OfflineProject {
  readonly dir: string;
  readonly contractPath: string;
  readonly migrationsDir: string;
  readonly appMigrationsDir: string;
}

const created: string[] = [];

export async function removeOfflineProjects(): Promise<void> {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * An emitted contract. With `models`, it carries an application domain whose
 * one namespace `app` declares those models, so statements can resolve.
 */
/** A model of a fixture contract: its name, or its name and the names of its scalar fields. */
export type FixtureModel = string | { readonly name: string; readonly fields: readonly string[] };

function modelEntry(model: FixtureModel): readonly [string, Record<string, unknown>] {
  const name = typeof model === 'string' ? model : model.name;
  const fields = typeof model === 'string' ? [] : model.fields;
  return [
    name,
    {
      fields: Object.fromEntries(
        fields.map((field) => [
          field,
          { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
        ]),
      ),
      relations: {},
      storage: {},
    },
  ];
}

export function contractJson(
  storageHash: string,
  models?: readonly FixtureModel[],
): Record<string, unknown> {
  return {
    storage: { storageHash, namespaces: {} },
    schemaVersion: '1.0.0',
    target: 'postgres',
    targetFamily: 'sql',
    models: {},
    ...(models === undefined
      ? {}
      : {
          domain: {
            namespaces: {
              app: {
                models: Object.fromEntries(models.map(modelEntry)),
              },
            },
          },
        }),
  };
}

export async function createOfflineProject(options: {
  readonly storageHash: string;
  readonly models?: readonly FixtureModel[];
}): Promise<OfflineProject> {
  const dir = createTestProjectDir('orm-offline');
  created.push(dir);
  const contractPath = join(dir, 'output', 'contract.json');
  await mkdir(join(dir, 'output'), { recursive: true });
  await writeFile(
    contractPath,
    JSON.stringify(contractJson(options.storageHash, options.models)),
    'utf-8',
  );
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'offline-fixture', dependencies: {} }),
    'utf-8',
  );
  return {
    dir,
    contractPath,
    migrationsDir: join(dir, 'migrations'),
    appMigrationsDir: join(dir, 'migrations', 'app'),
  };
}

export const ADDITIVE_OP = blindCast<
  MigrationPlanOperation,
  'The offline commands read only the id, label and class of a seeded operation'
>({ id: 'table.user', label: 'Create table "user"', operationClass: 'additive' });

/** An operation that carries an invariant, so a package can declare one. */
export function invariantOp(invariantId: string): MigrationPlanOperation {
  return blindCast<
    MigrationPlanOperation,
    'The offline commands read only the id, label, class and invariantId of a seeded operation'
  >({
    id: `constraint.${invariantId}`,
    label: `Add unique constraint ${invariantId}`,
    operationClass: 'additive',
    invariantId,
  });
}

export const DESTRUCTIVE_OP = blindCast<
  MigrationPlanOperation,
  'The offline commands read only the id, label and class of a seeded operation'
>({ id: 'table.drop_legacy', label: 'Drop table "legacy"', operationClass: 'destructive' });

export async function seedMigrationPackage(options: {
  readonly appMigrationsDir: string;
  readonly dirName: string;
  readonly from: string | null;
  readonly to: string;
  readonly ops?: readonly MigrationPlanOperation[];
}): Promise<{ readonly packageDir: string; readonly migrationHash: string }> {
  const ops = options.ops ?? [ADDITIVE_OP];
  const base: Omit<MigrationMetadata, 'migrationHash'> = {
    from: options.from,
    to: options.to,
    providedInvariants: deriveProvidedInvariants(ops),
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const metadata: MigrationMetadata = { ...base, migrationHash: computeMigrationHash(base, ops) };
  const packageDir = join(options.appMigrationsDir, options.dirName);
  await writeMigrationPackage(packageDir, metadata, ops);
  return { packageDir, migrationHash: metadata.migrationHash };
}

/**
 * The snapshot store entry a from-side resolution reads. `migration plan`
 * resolves its origin through the contract snapshot for that hash, so a plan
 * with any origin at all needs one on disk.
 */
export async function seedContractSnapshot(options: {
  readonly migrationsDir: string;
  readonly storageHash: string;
  readonly models?: readonly FixtureModel[];
}): Promise<void> {
  await writeContractSnapshot(options.migrationsDir, options.storageHash, {
    contractJson: contractJson(options.storageHash, options.models),
    contractDts: 'export type Contract = never;\n',
  });
}

/** Where `migration plan` believes the database sits: the `db` ref. */
export async function seedDbRef(options: {
  readonly appMigrationsDir: string;
  readonly storageHash: string;
}): Promise<void> {
  await writeRef(join(options.appMigrationsDir, 'refs'), 'db', {
    hash: options.storageHash,
    invariants: [],
  });
}

/**
 * The planner the fake target hands back. `plan` replays whatever operations
 * the test asked for; `emptyMigration` renders the stub `migration new` writes.
 * With `throwOnOperations`, any scripted `operations` still resolve alongside
 * the rejection — mirroring a real plan where some operations resolve and a
 * placeholder op rejects. `operationsByPlan` gives each successive `plan`
 * call its own operations, such as an auto-baseline's baseline and delta legs.
 */
export interface FakePlannerScript {
  readonly operations?: readonly MigrationPlanOperation[];
  readonly operationsByPlan?: ReadonlyArray<readonly MigrationPlanOperation[]>;
  readonly conflicts?: ReadonlyArray<{ readonly kind: string; readonly summary: string }>;
  readonly throwOnOperations?: unknown;
  readonly throwOnPlan?: unknown;
  /** Receives the statements of every `plan` call, in call order. */
  readonly statementsReceived?: unknown[][];
  /** Fails every `plan` call that is given statements, as a planner that refuses them does. */
  readonly refuseStatements?: boolean;
  /** What every `plan` call reports would lose data. */
  readonly dataLoss?: readonly ScriptedDataLoss[];
  /** What each successive `plan` call reports would lose data; overrides `dataLoss`. */
  readonly dataLossByPlan?: ReadonlyArray<readonly ScriptedDataLoss[]>;
  /** Reports `dataLoss` only from a `plan` call given no statements, as a rename removes a loss. */
  readonly statementsResolveDataLoss?: boolean;
  /** Reports `dataLoss` only from a `plan` call given fewer statements than this. */
  readonly statementsResolvingDataLoss?: number;
  /** Where in the operations the placeholder that `throwOnOperations` rejects sits; last by default. */
  readonly placeholderAt?: number;
  /** Makes the plan's `operations` accessor throw this synchronously. */
  readonly operationsAccessorThrows?: unknown;
}

/** A `dataLoss` entry of a scripted plan: the position of an operation and what it loses. */
export interface ScriptedDataLoss {
  readonly operationIndex: number;
  readonly subject:
    | { readonly kind: 'model'; readonly namespaceId: string; readonly model: string }
    | {
        readonly kind: 'field';
        readonly namespaceId: string;
        readonly model: string;
        readonly field: string;
      }
    | { readonly kind: 'storage'; readonly name: string };
}

function fakePlanner(script: FakePlannerScript): Record<string, unknown> {
  let planCalls = 0;
  return {
    plan: (options: { readonly statements: readonly unknown[] }) => {
      script.statementsReceived?.push([...options.statements]);
      if (script.throwOnPlan !== undefined) {
        throw script.throwOnPlan;
      }
      const operations = script.operationsByPlan?.[planCalls] ?? script.operations;
      const dataLoss =
        (script.statementsResolveDataLoss === true && options.statements.length > 0) ||
        options.statements.length >=
          (script.statementsResolvingDataLoss ?? Number.POSITIVE_INFINITY)
          ? []
          : (script.dataLossByPlan?.[planCalls] ?? script.dataLoss ?? []);
      planCalls += 1;
      const [refused] = script.refuseStatements === true ? options.statements : [];
      if (refused !== undefined) {
        return {
          kind: 'failure',
          conflicts: [{ kind: 'statementRefused', summary: 'Refused', refusedStatement: refused }],
        };
      }
      return script.conflicts === undefined
        ? {
            kind: 'success',
            dataLoss,
            accessWidening: [],
            appliedStatements: options.statements.map((statement) => ({
              statement,
              operationIndexes: (operations ?? [ADDITIVE_OP]).map((_, index) => index),
            })),
            plan: {
              get operations() {
                if (script.operationsAccessorThrows !== undefined) {
                  throw script.operationsAccessorThrows;
                }
                if (script.throwOnOperations === undefined) {
                  return (operations ?? [ADDITIVE_OP]).map((op) => Promise.resolve(op));
                }
                const resolved = (operations ?? []).map((op) => Promise.resolve(op));
                const placeholder = Promise.reject(script.throwOnOperations);
                placeholder.catch(() => undefined);
                const at = script.placeholderAt ?? resolved.length;
                return [...resolved.slice(0, at), placeholder, ...resolved.slice(at)];
              },
              renderTypeScript: () => '// planned migration\n',
            },
          }
        : { kind: 'failure', conflicts: script.conflicts };
    },
    emptyMigration: () => ({ renderTypeScript: () => '// empty migration\n' }),
  };
}

const SQL_POSTGRES = { familyId: 'sql', targetId: 'postgres', version: '1.0.0' };

export function offlineConfig(options: {
  readonly project: OfflineProject;
  readonly script?: FakePlannerScript;
  readonly targetSupportsMigrations?: boolean;
}): Record<string, unknown> {
  const migrations = {
    contractToSchema: () => ({}),
    createPlanner: () => fakePlanner(options.script ?? {}),
  };
  return {
    family: {
      ...SQL_POSTGRES,
      kind: 'family',
      id: 'sql',
      emission: {},
      create: () => ({ deserializeContract: (json: unknown) => json }),
    },
    target: {
      ...SQL_POSTGRES,
      kind: 'target',
      id: 'postgres',
      create: () => ({}),
      ...(options.targetSupportsMigrations === false ? {} : { migrations }),
    },
    adapter: { ...SQL_POSTGRES, kind: 'adapter', id: 'pg', create: () => ({}) },
    contract: {
      source: { format: 'typescript', inputs: [], load: async () => contractJson('unused') },
      output: options.project.contractPath,
    },
  };
}

export const RENDERED_CONTRACT_DTS = '// rendered\nexport type Contract = { rendered: true };\n';

/**
 * The control client the offline commands render snapshot declarations
 * through. Reset per test; override the render result to refuse.
 */
export const renderContractDtsMock: Mock = vi.fn();

export function resetRenderContractDtsMock(): void {
  renderContractDtsMock.mockReset().mockResolvedValue(ok({ contractDts: RENDERED_CONTRACT_DTS }));
}

export const OFFLINE_COMMANDS = createBinCommands(() =>
  blindCast<ControlClient, 'the offline commands only render snapshot declarations'>({
    renderContractDts: renderContractDtsMock,
  }),
);
