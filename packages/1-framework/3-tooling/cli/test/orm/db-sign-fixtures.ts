import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import type {
  SchemaDiffIssue,
  SignDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { readRef } from '@internal/migration-tools/refs';
import { blindCast } from '@internal/utils/casts';
import { ok } from '@internal/utils/result';
import type { MountedTree, PresentedResult } from '@prisma/cli-engine';
import type { Diagnostic } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
import { type Mock, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createDbSignCommand } from '../../src/orm/db/sign';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir, writeProjectManifest } from '../utils/test-project-dir';

export const HASH_A = `4cb4256${'0'.repeat(57)}`;
export const HASH_PREVIOUS = `9d0f118${'2'.repeat(57)}`;
export const CONNECTION = 'postgres://user:secret@localhost:5432/appdb';
export const MASKED_CONNECTION = 'postgres://****:****@localhost:5432/appdb';
export const EMITTED_CONTRACT_DTS = 'export type Contract = unknown;\n';
/** What the fake client renders for any contract: the snapshot must carry this, not the file on disk. */
export const RENDERED_CONTRACT_DTS = '// rendered\nexport type Contract = { rendered: true };\n';

export const mocks: Record<
  'connect' | 'close' | 'schemaVerify' | 'sign' | 'renderContractDts',
  Mock
> = {
  connect: vi.fn(),
  close: vi.fn(),
  schemaVerify: vi.fn(),
  sign: vi.fn(),
  renderContractDts: vi.fn(),
};

/**
 * The command is mounted over a fake control client instead of the module
 * being mocked: `createDbSignCommand` takes the client factory as its seam.
 */
const commands: MountedTree = {
  ...BIN_COMMANDS,
  'db sign': createDbSignCommand(() =>
    blindCast<ControlClient, 'the fake implements only what db sign touches'>({
      connect: mocks.connect,
      schemaVerify: mocks.schemaVerify,
      sign: mocks.sign,
      renderContractDts: mocks.renderContractDts,
      close: mocks.close,
    }),
  ),
};
const groups = BIN_GROUPS;

const dirs: string[] = [];

export async function projectDir(options: { readonly contract?: boolean } = {}): Promise<string> {
  const dir = createTestProjectDir('orm-db-sign');
  dirs.push(dir);
  writeProjectManifest(dir);
  if (options.contract !== false) {
    await mkdir(join(dir, 'output'), { recursive: true });
    await writeFile(
      join(dir, 'output', 'contract.json'),
      JSON.stringify({ storage: { storageHash: HASH_A }, target: 'postgres' }),
      'utf-8',
    );
    await writeFile(join(dir, 'output', 'contract.d.ts'), EMITTED_CONTRACT_DTS, 'utf-8');
  }
  return dir;
}

export async function cleanupProjectDirs(): Promise<void> {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
}

export function refsDirOf(dir: string): string {
  return join(dir, 'migrations', 'app', 'refs');
}

export async function refHashOf(dir: string, name: string): Promise<string | undefined> {
  return existsSync(join(refsDirOf(dir), `${name}.json`))
    ? (await readRef(refsDirOf(dir), name)).hash
    : undefined;
}

const DESCRIPTOR = { familyId: 'sql', targetId: 'postgres', version: '1.0.0', create: () => ({}) };

/**
 * The fake family stamps every contract it hydrates, so a test can tell a
 * value that crossed the `deserializeContract` seam from a bare `JSON.parse`.
 */
export function ormConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({
        deserializeContract: (json: unknown) => ({ ...Object(json), hydrated: true }),
      }),
    },
    target: { ...DESCRIPTOR, kind: 'target', id: 'postgres', migrations: {} },
    adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'pg' },
    driver: { ...DESCRIPTOR, kind: 'driver', id: 'pg-driver' },
    db: { connection: CONNECTION },
    contract: {
      source: { format: 'typescript', inputs: [], load: async () => ({}) },
      output: 'output/contract.json',
    },
    ...overrides,
  };
}

export function harness(config: Record<string, unknown>) {
  return createOrmTestCli({ commands, groups, orm: config });
}

export const MISSING_COLUMN = blindCast<
  SchemaDiffIssue,
  'The renderer reads the path and which side is present'
>({ path: ['public', 'users', 'email'], expected: { id: 'email', nodeKind: 'column' } });

export function schemaResult(
  overrides: Partial<VerifyDatabaseSchemaResult> = {},
): VerifyDatabaseSchemaResult {
  return {
    ok: true,
    summary: 'Database schema satisfies contract',
    contract: { storageHash: HASH_A },
    target: { expected: 'postgres' },
    schema: { issues: [] },
    meta: { strict: false },
    timings: { total: 1 },
    ...overrides,
  };
}

export function signResult(storageHash = HASH_A): SignDatabaseResult {
  return {
    ok: true,
    summary: 'Database signed',
    contract: { storageHash },
    target: { expected: 'postgres' },
    marker: { created: false, updated: true, previous: { storageHash: HASH_PREVIOUS } },
    timings: { total: 2 },
  };
}

/** The family signs the contract it is handed, so the fake reports that contract's hash. */
interface SignInput {
  readonly contract: { readonly storage: { readonly storageHash: string } };
}

export function resetMocks(): void {
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.schemaVerify.mockReset().mockResolvedValue(schemaResult());
  mocks.renderContractDts.mockReset().mockResolvedValue(ok({ contractDts: RENDERED_CONTRACT_DTS }));
  mocks.sign.mockReset().mockImplementation(async (input: SignInput) => {
    return signResult(input.contract.storage.storageHash);
  });
}

export function diagnosticsOf(run: {
  readonly presented: PresentedResult<unknown> | undefined;
}): readonly Diagnostic[] {
  return run.presented?.diagnostics ?? [];
}

export function envelopeOf(run: { readonly json: readonly { readonly kind: string }[] }) {
  const terminal = run.json.at(-1);
  return terminal !== undefined && terminal.kind === 'result'
    ? blindCast<{ ok: boolean; error?: { code: string }; exitCode?: number }, 'terminal frame'>(
        Reflect.get(terminal, 'envelope'),
      )
    : undefined;
}
