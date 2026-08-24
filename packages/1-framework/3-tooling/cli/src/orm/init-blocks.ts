import type { Block, Presentations, TreeNode } from '@prisma/cli-engine';
import type { NextAction } from '@prisma/cli-engine/protocol';
import type { InitOutput } from '../commands/init/output';
import { chooseAction, runCommandAction } from '../utils/next-actions';
import { EMIT_COMMAND } from './init-diagnostics';

function fileNodes(paths: readonly string[]): readonly TreeNode[] {
  return paths.map((path) => ({ label: path, tone: 'identifier' }));
}

function scaffoldTree(document: InitOutput): Block {
  const roots: TreeNode[] = [
    { label: 'written', tone: 'heading', children: fileNodes(document.filesWritten) },
  ];
  if (document.filesDeleted.length > 0) {
    roots.push({
      label: 'removed (stale artifacts and retired skill directories)',
      tone: 'heading',
      children: fileNodes(document.filesDeleted),
    });
  }
  const installed = document.packagesInstalled;
  if (installed.status === 'installed') {
    roots.push({
      label: 'installed',
      tone: 'heading',
      children: [
        ...fileNodes(installed.deps),
        ...installed.devDeps.map(
          (dep): TreeNode => ({ label: `${dep} (dev)`, tone: 'identifier' }),
        ),
      ],
    });
  }
  return { kind: 'tree', roots };
}

/**
 * The scaffold's follow-up steps, typed. `nextSteps` in the result document
 * keeps its numbered prose for consumers that already read it; these are the
 * same advice in the shape an agent can act on.
 */
export function buildInitNextActions(inputs: {
  readonly contractEmitted: boolean;
  readonly schemaPath: string;
}): readonly NextAction[] {
  const actions: NextAction[] = [
    chooseAction('Set DATABASE_URL in your environment (export it or add it to .env)'),
  ];
  if (!inputs.contractEmitted) {
    actions.push(runCommandAction('Emit the contract', EMIT_COMMAND));
  }
  actions.push({
    kind: 'edit-file',
    label: `Edit your schema at ${inputs.schemaPath}, then emit again`,
  });
  actions.push(
    chooseAction('Open prisma-next.md for a quick reference on writing your first typed query'),
  );
  actions.push(
    runCommandAction('Set up the Prisma agent skills for your coding agent', 'prisma init'),
  );
  return actions;
}

const DONE_TEXT = 'Done. Open prisma-next.md to get started.';
const INCOMPLETE_TEXT = 'Scaffold written. Finish the steps above to complete setup.';

/**
 * `init` writes files rather than data another program reads, so it supplies
 * no `stdout` payload: human mode writes nothing to stdout.
 */
export function initPresentations(inputs: {
  readonly document: InitOutput;
  readonly complete: boolean;
  readonly nextActions: readonly NextAction[];
}): Presentations {
  const { document } = inputs;
  return {
    stdout: () => [],
    human: (): readonly Block[] => [
      {
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'target', value: document.target },
          { label: 'authoring', value: document.authoring },
          { label: 'schema', value: document.schemaPath },
        ],
      },
      scaffoldTree(document),
      inputs.complete
        ? { kind: 'summary', status: 'ok', text: DONE_TEXT }
        : { kind: 'summary', status: 'warn', text: INCOMPLETE_TEXT },
    ],
    json: () => document,
    next: () => inputs.nextActions,
  };
}
