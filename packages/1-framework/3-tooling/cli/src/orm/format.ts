import type { Block, Presentations } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { relative } from 'pathe';
import type { FormatOperationResult } from '../control-api/operations/format';
import { executeFormat } from '../control-api/operations/format';
import { ormConfigSection } from './config-section';
import { defineOrmCommand } from './define-command';
import { normalizeError } from './normalize-error';

const NOTHING_TO_FORMAT = 'Nothing to format (contract source is not PSL).';

function formatPresentations(document: FormatOperationResult, cwd: string): Presentations {
  const path = document.path;
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] =>
      document.formatted && path !== undefined
        ? [
            {
              kind: 'summary',
              status: 'ok',
              text: [{ text: 'Formatted ' }, { text: relative(cwd, path), tone: 'identifier' }],
            },
          ]
        : [{ kind: 'summary', status: 'info', text: NOTHING_TO_FORMAT }],
    json: () => document,
  };
}

export function createFormatCommand(execute: typeof executeFormat = executeFormat) {
  return defineOrmCommand({
    help: {
      summary: 'Format your PSL contract source',
      description:
        'Formats the Prisma schema (PSL) contract source declared in your config\n' +
        '(contract.source.inputs[0]) in place. Only runs when contract.source.format\n' +
        "is 'psl'; a TypeScript or unset source is left untouched. Indent and newline\n" +
        'are read from the optional formatter config section, defaulting to two\n' +
        'spaces and the system newline.',
      examples: ['contract format', 'contract format --json'],
    },
    needs: { config: ormConfigSection },
    handler: async (_args, ctx) => {
      const result = await execute({ config: ctx.config, cwd: ctx.cwd });
      if (!result.ok) {
        return notOk(normalizeError(result.failure));
      }
      return ok(ctx.present({ data: result.value }, formatPresentations(result.value, ctx.cwd)));
    },
  });
}

export const formatCommand = createFormatCommand();
