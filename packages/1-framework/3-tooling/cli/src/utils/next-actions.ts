import type { NextAction } from '@prisma/cli-engine/protocol';
import { resolveBin } from '../orm/bin-name';

/**
 * The typed remediation the CLI attaches to its own errors and findings.
 * Constructors live here rather than in any library the CLI calls: naming a
 * runnable invocation is something only the CLI can do.
 */
export function runCommandAction(label: string, command: string): NextAction {
  return { kind: 'run-command', label: resolveBin(label), command: resolveBin(command) };
}

/** Advice the user acts on themselves — there is no command to run. */
export function chooseAction(label: string): NextAction {
  return { kind: 'user-choice', label };
}
