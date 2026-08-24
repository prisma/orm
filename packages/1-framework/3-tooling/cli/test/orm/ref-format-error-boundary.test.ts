import { CliStructuredError } from '@internal/errors/control';
import type { ErroredEnvelope, MountedTree, StreamEvent } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { executeFormat } from '../../src/control-api/operations/format';
import type {
  executeRefDeleteCommand,
  executeRefListCommand,
  executeRefSetCommand,
} from '../../src/control-api/operations/ref';
import { BIN_GROUPS } from '../../src/orm/cli';
import { createFormatCommand } from '../../src/orm/format';
import { createRefDeleteCommand } from '../../src/orm/ref/delete';
import { createRefListCommand } from '../../src/orm/ref/list';
import { createRefSetCommand } from '../../src/orm/ref/set';

const operations = {
  executeFormat: vi.fn<typeof executeFormat>(),
  executeRefDeleteCommand: vi.fn<typeof executeRefDeleteCommand>(),
  executeRefListCommand: vi.fn<typeof executeRefListCommand>(),
  executeRefSetCommand: vi.fn<typeof executeRefSetCommand>(),
};

const commands: MountedTree = {
  'contract format': createFormatCommand(operations.executeFormat),
  'migration ref delete': createRefDeleteCommand(operations.executeRefDeleteCommand),
  'migration ref list': createRefListCommand(operations.executeRefListCommand),
  'migration ref set': createRefSetCommand(operations.executeRefSetCommand),
};

beforeEach(() => {
  for (const operation of Object.values(operations)) {
    operation.mockReset();
  }
});

const DESCRIPTOR = {
  familyId: 'sql',
  targetId: 'postgres',
  version: '1.0.0',
  create: () => ({}),
};

function harness() {
  return createTestCli({
    commands,
    groups: BIN_GROUPS,
    config: {
      orm: {
        family: {
          kind: 'family',
          id: 'sql',
          familyId: 'sql',
          version: '1.0.0',
          emission: {},
          create: () => ({}),
        },
        target: { ...DESCRIPTOR, kind: 'target', id: 'postgres' },
        adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'pg' },
      },
    },
  });
}

function erroredEnvelope(run: { readonly json: readonly StreamEvent[] }): ErroredEnvelope {
  const terminal = run.json.at(-1);
  if (terminal === undefined || terminal.kind !== 'result' || terminal.envelope.ok) {
    throw new Error('the run did not settle as an errored envelope');
  }
  return terminal.envelope;
}

/**
 * A structured error as prisma/prisma raises one: `fix` prose, and no typed
 * next actions. Its class shares a name with the engine's, so the engine's
 * duck test accepts it and settles it through a `toEnvelope` that writes the
 * non-protocol `fix` field — unless the command's own boundary converts it
 * first.
 */
const RAISED_BY_PRISMA = new CliStructuredError(
  'CONFIG.VALIDATION_FAILED',
  'Prisma Next configuration is not usable',
  {
    why: 'contract.source.inputs names a file that does not exist.',
    fix: 'Correct contract.source.inputs in prisma.config.ts and re-run',
  },
);

interface BoundaryCase {
  readonly command: string;
  readonly argv: readonly string[];
  readonly operation: Mock;
}

const HASH = `4cb4256${'0'.repeat(57)}`;

const CASES: readonly BoundaryCase[] = [
  { command: 'format', argv: ['contract', 'format'], operation: operations.executeFormat },
  {
    command: 'ref delete',
    argv: ['migration', 'ref', 'delete', 'staging'],
    operation: operations.executeRefDeleteCommand,
  },
  {
    command: 'ref list',
    argv: ['migration', 'ref', 'list'],
    operation: operations.executeRefListCommand,
  },
  {
    command: 'ref set',
    argv: ['migration', 'ref', 'set', 'staging', HASH],
    operation: operations.executeRefSetCommand,
  },
];

describe.each(CASES)('$command', ({ argv, operation }) => {
  describe('an operation that throws a prisma/prisma structured error', () => {
    it('settles a protocol envelope carrying typed next actions', async () => {
      operation.mockRejectedValue(RAISED_BY_PRISMA);

      const run = await harness().run([...argv, '--json'], { cwd: process.cwd() });
      const envelope = erroredEnvelope(run);

      expect(run.exitCode).toBe(2);
      expect(envelope.error).toMatchObject({ code: 'CONFIG.VALIDATION_FAILED' });
      expect(envelope.error).not.toHaveProperty('fix');
      expect(envelope.nextActions).toEqual([
        {
          kind: 'user-choice',
          label: 'Correct contract.source.inputs in prisma.config.ts and re-run',
        },
      ]);
    });
  });

  describe('an operation that throws a bare Error', () => {
    it('settles CLI.UNEXPECTED at exit 2 rather than an engine bug at exit 1', async () => {
      operation.mockRejectedValue(new Error('connection reset'));

      const run = await harness().run([...argv, '--json'], { cwd: process.cwd() });

      expect(run.exitCode).toBe(2);
      expect(erroredEnvelope(run).error).toMatchObject({
        code: 'CLI.UNEXPECTED',
        summary: 'connection reset',
      });
    });
  });
});
