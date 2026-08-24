import type { Refs } from '@internal/migration-tools/refs';
import type { Block, Presentations, Text } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import type { RefListResult } from '../../control-api/operations/ref';
import { executeRefListCommand } from '../../control-api/operations/ref';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { normalizeError } from '../normalize-error';

const HEADING_REF = 'Ref';
const HEADING_CONTRACT = 'Contract';
const HEADING_INVARIANTS = 'Invariants';

const EMPTY_MESSAGE = 'No refs defined';

/**
 * The refs as a grid the engine sizes. The invariants heading appears only
 * when a ref carries any, as the commander shell appended them only then.
 */
function refsGrid(refs: Refs): Block {
  const entries = Object.entries(refs);
  const showInvariants = entries.some(([, entry]) => entry.invariants.length > 0);
  const headings: Text[] = showInvariants
    ? [HEADING_REF, HEADING_CONTRACT, HEADING_INVARIANTS]
    : [HEADING_REF, HEADING_CONTRACT];

  const rows = entries.map(([name, entry]) => {
    const cells: Text[] = [
      [{ text: name, tone: 'ref' }],
      [{ text: entry.hash, tone: 'identifier' }],
    ];
    if (showInvariants) {
      cells.push(entry.invariants.join(', '));
    }
    return cells;
  });

  // biome-ignore lint/plugin/no-family-vocabulary: the cli-engine block type for a grid of terminal output; `table` and `columns` are its property names
  return { kind: 'table', columns: headings, rows };
}

function listPresentations(document: RefListResult): Presentations {
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] =>
      Object.keys(document.refs).length === 0
        ? [{ kind: 'summary', status: 'info', text: EMPTY_MESSAGE }]
        : [refsGrid(document.refs)],
    json: () => document,
  };
}

export function createRefListCommand(
  execute: typeof executeRefListCommand = executeRefListCommand,
) {
  return defineOrmCommand({
    help: {
      summary: 'List every named ref',
      description:
        'Reads migrations/app/refs/ and reports each ref with the contract hash it\n' +
        'points at and the invariants recorded against it. Offline — does not\n' +
        'consult the database.',
      examples: ['migration ref list', 'migration ref list --json'],
    },
    needs: { config: ormConfigSection },
    handler: async (_args, ctx) => {
      const result = await execute({ config: ctx.config, cwd: ctx.cwd });
      if (!result.ok) {
        return notOk(normalizeError(result.failure));
      }
      return ok(ctx.present({ data: result.value }, listPresentations(result.value)));
    },
  });
}

export const refListCommand = createRefListCommand();
