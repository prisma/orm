import { closeSync, openSync } from 'node:fs';
import type { HostProcess, LoadedConfig } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  BIN_COMMANDS,
  BIN_GROUPS,
  createOrmCli,
  runOrmCli,
  runtimeFromProcess,
} from '../../src/orm/cli';
import { ormCommandFamily } from '../../src/orm/family';
import { createTestProjectDir } from '../utils/test-project-dir';

function recordingLoader(): {
  readonly asked: string[];
  readonly loadConfig: (configPath?: string) => Promise<LoadedConfig>;
} {
  const asked: string[] = [];
  return {
    asked,
    loadConfig: (configPath) => {
      asked.push(configPath ?? '(none)');
      return Promise.resolve({ files: [], diagnostics: [] });
    },
  };
}

function harness(loadConfig: (configPath?: string) => Promise<LoadedConfig>) {
  return createTestCli({
    commandFamilies: [ormCommandFamily],
    commands: BIN_COMMANDS,
    groups: BIN_GROUPS,
    loadConfig,
  });
}

describe('the --config flag', () => {
  it('hands the separated path to the loader', async () => {
    const loader = recordingLoader();

    await harness(loader.loadConfig).run(['migration', 'list', '--config', 'custom.ts']);

    expect(loader.asked).toEqual(['custom.ts']);
  });

  it('hands the attached --config=<path> to the loader', async () => {
    const loader = recordingLoader();

    await harness(loader.loadConfig).run(['migration', 'list', '--config=/abs/custom.ts']);

    expect(loader.asked).toEqual(['/abs/custom.ts']);
  });

  it('asks for the default file when no path is given', async () => {
    const loader = recordingLoader();

    await harness(loader.loadConfig).run(['migration', 'list']);

    expect(loader.asked).toEqual(['(none)']);
  });
});

describe('the orm command family', () => {
  it('carries the orm config section', () => {
    expect(ormCommandFamily.configSection?.name).toBe('orm');
  });

  it('publishes a docs base the engine can append a code to', () => {
    expect(ormCommandFamily.docsBaseUrl?.endsWith('/')).toBe(true);
  });

  it('retires the removed verb, the four removed status flags and the Prisma 7 migrate commands, naming the binary as {bin}', () => {
    expect(
      ormCommandFamily.redirects.map(({ from, flag, replacement }) => ({
        from,
        flag,
        replacement,
      })),
    ).toEqual([
      {
        from: 'migration apply',
        flag: undefined,
        replacement: '{bin} db migrate --to <contract>',
      },
      { from: 'migration status', flag: 'graph', replacement: '{bin} migration graph' },
      {
        from: 'migration status',
        flag: 'all',
        replacement: '{bin} migration log --db <url>',
      },
      {
        from: 'migration status',
        flag: 'limit',
        replacement: '{bin} migration log --db <url>',
      },
      {
        from: 'migration status',
        flag: 'ref',
        replacement: '{bin} migration status --to <contract>',
      },
      { from: 'migrate dev', flag: undefined, replacement: '{bin} contract emit' },
      { from: 'migrate deploy', flag: undefined, replacement: '{bin} db migrate' },
      { from: 'migrate status', flag: undefined, replacement: '{bin} migration status' },
      { from: 'migrate diff', flag: undefined, replacement: '{bin} db update --dry-run' },
      { from: 'migrate reset', flag: undefined, replacement: '{bin} db update' },
      { from: 'migrate resolve', flag: undefined, replacement: '{bin} db sign <migration>' },
    ]);
  });
});

describe('createOrmCli', () => {
  it('constructs without a collision, unknown group or reserved-flag violation', () => {
    expect(() => createOrmCli()).not.toThrow();
  });
});

describe("the engine's telemetry command group", () => {
  it('mounts the three consent commands and their group, mirroring the unified bin', () => {
    expect(Object.keys(BIN_COMMANDS)).toEqual(
      expect.arrayContaining(['telemetry status', 'telemetry enable', 'telemetry disable']),
    );
    expect(BIN_GROUPS).toMatchObject({
      telemetry: { brief: expect.stringContaining('telemetry') },
    });
  });

  it('settles telemetry status as data through the mounted tree', async () => {
    const xdgDir = createTestProjectDir('telemetry-xdg');

    const run = await harness(recordingLoader().loadConfig).run(['telemetry', 'status', '--json'], {
      env: { XDG_CONFIG_HOME: xdgDir },
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toEqual({
      enabled: true,
      reason: 'default-on',
      configPath: join(xdgDir, 'prisma', 'config.json'),
      installationIdStored: false,
    });
  });
});

describe('a retired invocation', () => {
  it('is answered with its replacement rather than a spelling suggestion', async () => {
    const loader = recordingLoader();

    const run = await harness(loader.loadConfig).run(['migration', 'apply', '--json']);

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'CLI.COMMAND_MOVED',
          summary: '`migration apply` has been replaced',
          why: 'Applying a migration is a move to a target contract, not a verb of its own.',
          nextActions: [
            {
              kind: 'run-command',
              label: 'Use the replacement',
              command: 'prisma-test db migrate --to <contract>',
            },
          ],
        },
      },
    });
    expect(JSON.stringify(run.json)).not.toContain('Did you mean');
  });

  it.each([
    {
      verb: 'dev',
      why: "Prisma 8 emits the contract, plans the migration and applies it in separate steps: run `contract emit`, then `migration plan --name <name>` (for `--create-only`, stop here), then `db migrate --advance-ref db`; while Prisma 7 still owns this project's migrations, run `migrate dev` with Prisma 7's CLI instead.",
      command: 'prisma-test contract emit',
    },
    {
      verb: 'deploy',
      why: "`db migrate` applies the planned migrations; while Prisma 7 still owns this project's migrations, run `migrate deploy` with Prisma 7's CLI instead.",
      command: 'prisma-test db migrate',
    },
    {
      verb: 'status',
      why: "`migration status` reports which planned migrations the database has applied; while Prisma 7 still owns this project's migrations, run `migrate status` with Prisma 7's CLI instead.",
      command: 'prisma-test migration status',
    },
    {
      verb: 'diff',
      why: '`db update --dry-run` prints the changes between the contract and a live database without applying them; to write the changes between two contracts as a migration package use `migration plan`, and to report drift use `db verify`.',
      command: 'prisma-test db update --dry-run',
    },
    {
      verb: 'reset',
      why: "Prisma 8 has no reset: `db update` moves the database to the contract without a reset and asks before losing data, on a database whose migration history does not need to be kept; a database that changes only through migrations is moved with `db migrate`; while Prisma 7 still owns this project's migrations, run `migrate reset` with Prisma 7's CLI instead.",
      command: 'prisma-test db update',
    },
    {
      verb: 'resolve',
      why: "`db sign <migration>` checks that the database already has that migration's schema and moves the database marker to that migration's contract, so `db migrate` continues after it; `migration status` does not list the migration as applied. Use it where you would run `migrate resolve --applied` after applying a migration's changes by hand. While Prisma 7 still owns this project's migrations, run `migrate resolve` with Prisma 7's CLI instead.",
      command: 'prisma-test db sign <migration>',
    },
  ])('answers Prisma 7 migrate $verb with its Prisma 8 command', async ({ verb, why, command }) => {
    const run = await harness(recordingLoader().loadConfig).run(['migrate', verb, '--json']);

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'CLI.COMMAND_MOVED',
          why,
          nextActions: [{ kind: 'run-command', label: 'Use the replacement', command }],
        },
      },
    });
  });

  it('answers a retired status flag with the command that replaced it', async () => {
    const loader = recordingLoader();

    const run = await harness(loader.loadConfig).run(['migration', 'status', '--graph', '--json']);

    expect(run.exitCode).not.toBe(0);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: { code: 'CLI.COMMAND_MOVED' },
        nextActions: [
          {
            kind: 'run-command',
            label: 'Use the replacement',
            command: 'prisma-test migration graph',
          },
        ],
      },
    });
  });
});

/**
 * A host process whose working directory has been unlinked: `process.cwd()`
 * throws ENOENT, which is the shape of every startup failure that happens
 * before the engine has a run to settle.
 */
function processWithUnreadableCwd(stderr: string[]): HostProcess {
  return {
    argv: ['node', 'prisma', 'migration', 'list'],
    env: {},
    version: process.version,
    versions: process.versions,
    platform: process.platform,
    arch: process.arch,
    cwd: () => {
      throw new Error('ENOENT: uv_cwd');
    },
    stdout: { write: () => true },
    stderr: { write: (text: string) => stderr.push(text) },
    stdin: { [Symbol.asyncIterator]: () => [][Symbol.iterator]() as never },
    on: () => undefined,
    off: () => undefined,
    exit: () => {
      throw new Error('exit must not be called');
    },
  };
}

function processWithOutputStreams(
  stdout: HostProcess['stdout'] & { readonly fd?: number },
  stderr: HostProcess['stderr'] & { readonly fd?: number },
): HostProcess {
  return {
    argv: ['node', 'prisma'],
    env: {},
    version: process.version,
    versions: process.versions,
    platform: process.platform,
    arch: process.arch,
    cwd: () => '/',
    stdout,
    stderr,
    stdin: { [Symbol.asyncIterator]: () => [][Symbol.iterator]() as never },
    on: () => undefined,
    off: () => undefined,
    exit: () => {
      throw new Error('exit must not be called');
    },
  };
}

describe('runtimeFromProcess', () => {
  it('reports that stdout and stderr share a device when their fds name the same file', () => {
    const dir = createTestProjectDir('orm-share-device-same');
    const first = openSync(join(dir, 'screen.log'), 'w');
    const second = openSync(join(dir, 'screen.log'), 'w');
    try {
      const runtime = runtimeFromProcess(
        processWithOutputStreams(
          { write: () => true, fd: first },
          { write: () => true, fd: second },
        ),
      );
      expect(runtime.outputStreamsShareDevice).toBe(true);
    } finally {
      closeSync(first);
      closeSync(second);
    }
  });

  it('reports separate devices when the fds name different files', () => {
    const dir = createTestProjectDir('orm-share-device-split');
    const out = openSync(join(dir, 'out.log'), 'w');
    const err = openSync(join(dir, 'err.log'), 'w');
    try {
      const runtime = runtimeFromProcess(
        processWithOutputStreams({ write: () => true, fd: out }, { write: () => true, fd: err }),
      );
      expect(runtime.outputStreamsShareDevice).toBe(false);
    } finally {
      closeSync(out);
      closeSync(err);
    }
  });

  it('leaves the answer absent when a stream exposes no fd', () => {
    const runtime = runtimeFromProcess(
      processWithOutputStreams({ write: () => true }, { write: () => true }),
    );
    expect(runtime.outputStreamsShareDevice).toBeUndefined();
  });

  it('leaves the answer absent when an fd cannot be stat-ed', () => {
    const runtime = runtimeFromProcess(
      processWithOutputStreams({ write: () => true, fd: -1 }, { write: () => true, fd: -1 }),
    );
    expect(runtime.outputStreamsShareDevice).toBeUndefined();
  });
});

describe('runOrmCli', () => {
  it('reports a startup failure as a structured line instead of a raw stack trace', async () => {
    const stderr: string[] = [];

    const code = await runOrmCli(processWithUnreadableCwd(stderr));

    expect(code).toBe(1);
    expect(stderr.join('')).toContain('[CLI.UNEXPECTED]');
    expect(stderr.join('')).toContain('ENOENT: uv_cwd');
  });
});
