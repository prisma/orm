import { rmSync, writeFileSync } from 'node:fs';
import type { StreamEvent } from '@prisma/cli-engine';
import { join } from 'pathe';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir, writeProjectManifest } from '../utils/test-project-dir';

const mocks = {
  connect: vi.fn(),
  dbInit: vi.fn(),
  dbUpdate: vi.fn(),
  migrate: vi.fn(),
  close: vi.fn(),
};

const commands = createBinCommands(
  () =>
    ({
      connect: mocks.connect,
      dbInit: mocks.dbInit,
      dbUpdate: mocks.dbUpdate,
      migrate: mocks.migrate,
      close: mocks.close,
    }) as unknown as ControlClient,
);

const DESCRIPTOR = { familyId: 'sql', targetId: 'postgres', version: '1.0.0', create: () => ({}) };
const ADVICE = 'Apply the schema change with the owning tool';

const projectDirs: string[] = [];
let projectDir: string;

afterAll(() => {
  for (const dir of projectDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  projectDir = createTestProjectDir('orm-db-schema-owner');
  projectDirs.push(projectDir);
  writeProjectManifest(projectDir);
  writeFileSync(
    join(projectDir, 'contract.json'),
    JSON.stringify({ storage: { storageHash: 'a'.repeat(64) } }),
  );
  for (const mock of Object.values(mocks)) mock.mockReset();
});

function ownedConfig(): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({}),
    },
    target: { ...DESCRIPTOR, kind: 'target', id: 'postgres', migrations: {} },
    adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'pg' },
    driver: { ...DESCRIPTOR, kind: 'driver', id: 'pg-driver' },
    db: { connection: 'postgres://user:secret@localhost:5432/appdb' },
    contract: {
      source: {
        format: 'psl',
        inputs: [],
        load: async () => ({}),
        schemaOwner: { applySchemaChangeAdvice: ADVICE },
      },
      output: join(projectDir, 'contract.json'),
    },
  };
}

function envelopeOf(json: readonly StreamEvent[]): unknown {
  const terminal = json.at(-1);
  return terminal?.kind === 'result' ? terminal.envelope : undefined;
}

describe('a database whose schema another tool changes', () => {
  it.each([
    ['db update', ['db', 'update']],
    ['db update --dry-run', ['db', 'update', '--dry-run']],
    ['db init', ['db', 'init']],
    ['db migrate', ['db', 'migrate']],
  ])('%s refuses before connecting and points at that tool', async (_name, argv) => {
    const run = await createOrmTestCli({ commands, groups: BIN_GROUPS, orm: ownedConfig() }).run(
      [...argv, '--json'],
      { cwd: projectDir },
    );

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: {
        code: 'MIGRATION.SCHEMA_OWNED_ELSEWHERE',
        nextActions: [
          { kind: 'user-choice', label: ADVICE },
          { kind: 'run-command', label: 'Then sign the database again', command: '{bin} db sign' },
        ],
      },
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
