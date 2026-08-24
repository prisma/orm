import type { Block, Presentations } from '@prisma/cli-engine';
import { positional } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import type { RefDeleteResult } from '../../control-api/operations/ref';
import { executeRefDeleteCommand } from '../../control-api/operations/ref';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { normalizeError } from '../normalize-error';

function deletePresentations(document: RefDeleteResult): Presentations {
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] => [
      {
        kind: 'summary',
        status: 'ok',
        text: [{ text: 'Deleted ref "' }, { text: document.ref, tone: 'ref' }, { text: '"' }],
      },
    ],
    json: () => document,
  };
}

export function createRefDeleteCommand(
  execute: typeof executeRefDeleteCommand = executeRefDeleteCommand,
) {
  return defineOrmCommand({
    help: {
      summary: 'Delete a ref',
      description:
        'Removes migrations/app/refs/<name>.json. The contract the ref pointed at\n' +
        'is untouched: a ref is a pointer, and its target survives the deletion.',
      examples: ['migration ref delete staging', 'migration ref delete staging --json'],
    },
    args: {
      positionals: {
        name: positional.string({ brief: 'Ref name to delete', placeholder: 'name' }),
      },
    },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      const result = await execute(args.positionals.name, {
        config: ctx.config,
        cwd: ctx.cwd,
      });
      if (!result.ok) {
        return notOk(normalizeError(result.failure));
      }
      return ok(ctx.present({ data: result.value }, deletePresentations(result.value)));
    },
  });
}

export const refDeleteCommand = createRefDeleteCommand();
