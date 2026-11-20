import type { NextAction } from '@prisma/cli-engine/protocol';

/**
 * The typed remediation the CLI attaches to its own errors and findings.
 * Constructors live here rather than in any library the CLI calls: naming a
 * runnable invocation is something only the CLI can do.
 */
export function runCommandAction(label: string, command: string): NextAction {
  return { kind: 'run-command', label, command };
}

/** Advice the user carries out or decides on themselves, such as changing data in the database or choosing between plans; it has no command to run and edits no file. */
export function chooseAction(label: string): NextAction {
  return { kind: 'user-choice', label };
}

/** Advice that changes a file before anything runs again. */
export function editFileAction(label: string): NextAction {
  return { kind: 'edit-file', label };
}
