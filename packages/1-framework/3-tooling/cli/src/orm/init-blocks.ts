import type { Block, Presentations, TreeNode } from '@prisma/cli-engine';
import type { NextAction } from '@prisma/cli-engine/protocol';
import {
  DB_SIGN_STEP,
  type InitOutput,
  PRISMA7_LOOP_STEP,
  PRISMA7_QUICK_REFERENCE_STEP,
} from '../commands/init/output';
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
  if (document.filesRenamed.length > 0) {
    roots.push({
      label: 'renamed',
      tone: 'heading',
      children: document.filesRenamed.map(
        (entry): TreeNode => ({ label: `${entry.from} → ${entry.to}`, tone: 'identifier' }),
      ),
    });
  }
  const installed = document.packagesInstalled;
  if (installed.status === 'installed') {
    const moved = new Set(document.prisma7?.packagesMoved ?? []);
    const suffix = (dep: string, dev: boolean): string => {
      const notes = [...(dev ? ['dev'] : []), ...(moved.has(dep) ? ['Prisma 7'] : [])];
      return notes.length === 0 ? dep : `${dep} (${notes.join(', ')})`;
    };
    roots.push({
      label: 'installed',
      tone: 'heading',
      children: [
        ...installed.deps.map(
          (dep): TreeNode => ({ label: suffix(dep, false), tone: 'identifier' }),
        ),
        ...installed.devDeps.map(
          (dep): TreeNode => ({ label: suffix(dep, true), tone: 'identifier' }),
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
  readonly prisma7: { readonly clientMoved: boolean } | null;
}): readonly NextAction[] {
  const actions: NextAction[] = [
    chooseAction('Set DATABASE_URL in your environment (export it or add it to .env)'),
  ];
  if (!inputs.contractEmitted) {
    actions.push(runCommandAction('Emit the contract', EMIT_COMMAND));
  }
  if (inputs.prisma7 !== null) {
    actions.push(runCommandAction(DB_SIGN_STEP, 'prisma db sign'));
    actions.push({
      kind: 'edit-file',
      label: 'Move your routes one at a time to the Prisma 8 client in src/prisma/db.ts',
    });
    actions.push(chooseAction(PRISMA7_LOOP_STEP));
    if (inputs.prisma7.clientMoved) {
      actions.push(
        runCommandAction('Regenerate the Prisma 7 client to match its CLI', 'prisma7 generate'),
      );
    }
    actions.push(chooseAction(PRISMA7_QUICK_REFERENCE_STEP));
    actions.push(
      runCommandAction('Set up the Prisma agent skills for your coding agent', 'prisma init'),
    );
    return actions;
  }
  actions.push({
    kind: 'edit-file',
    label: `Edit your schema at ${inputs.schemaPath}, then emit again`,
  });
  actions.push(
    chooseAction('Open prisma-8.md for a quick reference on writing your first typed query'),
  );
  actions.push(
    runCommandAction('Set up the Prisma agent skills for your coding agent', 'prisma init'),
  );
  return actions;
}

const DONE_TEXT = 'Done. Open prisma-8.md to get started.';
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
