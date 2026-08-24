import type { Block, Presentations } from '@prisma/cli-engine';
import { positional } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import type { RefSetResult } from '../../control-api/operations/ref';
import { executeRefSetCommand } from '../../control-api/operations/ref';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { normalizeError } from '../normalize-error';

function setPresentations(document: RefSetResult): Presentations {
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] => [
      {
        kind: 'summary',
        status: 'ok',
        text: [
          { text: 'Set ref "' },
          { text: document.ref, tone: 'ref' },
          { text: '" → ' },
          { text: document.hash, tone: 'identifier' },
        ],
      },
    ],
    json: () => document,
  };
}

export function createRefSetCommand(execute: typeof executeRefSetCommand = executeRefSetCommand) {
  return defineOrmCommand({
    help: {
      summary: 'Point a ref at a contract',
      description:
        'Writes migrations/app/refs/<name>.json so a logical environment name\n' +
        'resolves to a contract hash. The contract is given as a hash or prefix,\n' +
        'another ref name, a migration directory name, or <dir>^ for that\n' +
        "migration's source contract. Offline — the contract must already be a\n" +
        'node of the on-disk migration graph, with its snapshot present.',
      examples: [
        'migration ref set staging 4cb4256',
        'migration ref set production 20260101T1000_add_user',
        'migration ref set staging production --json',
      ],
    },
    args: {
      positionals: {
        name: positional.string({
          brief: 'Ref name (e.g. staging, production)',
          placeholder: 'name',
        }),
        contract: positional.string({
          brief: 'Contract reference: hash, prefix, ref name, migration dir name, or <dir>^',
          placeholder: 'contract',
        }),
      },
    },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      const result = await execute(args.positionals.name, args.positionals.contract, {
        config: ctx.config,
        cwd: ctx.cwd,
      });
      if (!result.ok) {
        return notOk(normalizeError(result.failure));
      }
      return ok(ctx.present({ data: result.value }, setPresentations(result.value)));
    },
  });
}

export const refSetCommand = createRefSetCommand();
