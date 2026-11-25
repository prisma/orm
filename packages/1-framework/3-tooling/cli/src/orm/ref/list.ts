import { ormConfigSection } from '@internal/config-loader';
import {
  type DeclaredDatabasePolicies,
  databasePolicyValueText,
} from '@internal/framework-components/control';
import type { Refs } from '@internal/migration-tools/refs';
import type { Block, Presentations, Text } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import type { RefListResult } from '../../control-api/operations/ref';
import { executeRefListCommand } from '../../control-api/operations/ref';
import { dataLine } from '../data-lines';
import { defineOrmCommand } from '../define-command';
import { normalizeError } from '../normalize-error';

const HEADING_REF = 'Ref';
const HEADING_CONTRACT = 'Contract';
const HEADING_INVARIANTS = 'Invariants';
const HEADING_POLICIES = 'Policies';

const EMPTY_MESSAGE = 'No refs defined';

/** `change: migrate; dataProtection.dataLoss: data-loss-forbidden`: each setting the ref declares. */
function declaredPoliciesText(policies: DeclaredDatabasePolicies | undefined): string {
  const settings: (readonly [string, Parameters<typeof databasePolicyValueText>[0] | undefined])[] =
    [
      ['change', policies?.change],
      ['dataProtection.dataLoss', policies?.dataProtection?.dataLoss],
      ['dataProtection.accessWidening', policies?.dataProtection?.accessWidening],
    ];
  return settings
    .flatMap(([setting, value]) =>
      value === undefined ? [] : [`${setting}: ${databasePolicyValueText(value)}`],
    )
    .join('; ');
}

/**
 * The refs as a grid the engine sizes. The invariants and policies headings appear only
 * when a ref carries any.
 */
function refsGrid(refs: Refs): Block {
  const entries = Object.entries(refs);
  const showInvariants = entries.some(([, entry]) => entry.invariants.length > 0);
  const showPolicies = entries.some(([, entry]) => declaredPoliciesText(entry.policies) !== '');
  const headings: Text[] = [
    HEADING_REF,
    HEADING_CONTRACT,
    ...(showInvariants ? [HEADING_INVARIANTS] : []),
    ...(showPolicies ? [HEADING_POLICIES] : []),
  ];

  const rows = entries.map(([name, entry]) => {
    const cells: Text[] = [
      [{ text: name, tone: 'ref' }],
      [{ text: entry.hash, tone: 'identifier' }],
    ];
    if (showInvariants) {
      cells.push(entry.invariants.join(', '));
    }
    if (showPolicies) {
      cells.push(declaredPoliciesText(entry.policies));
    }
    return cells;
  });

  // biome-ignore lint/plugin/no-family-vocabulary: the cli-engine block type for a grid of terminal output; `table` and `columns` are its property names
  return { kind: 'table', columns: headings, rows };
}

function listPresentations(document: RefListResult): Presentations {
  return {
    stdout: () =>
      Object.entries(document.refs).map(([name, entry]) =>
        dataLine([name, entry.hash, entry.invariants.join(',')]),
      ),
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
