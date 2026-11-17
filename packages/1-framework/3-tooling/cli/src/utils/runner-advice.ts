import type { NextAction } from '@prisma/cli-engine/protocol';

/**
 * The ways out of a failed apply, one next action each. A label says the whole way out, with what
 * the CLI knows of where things stand, and names a command only when the action does not carry it.
 */
export type RunnerAdvice = readonly NextAction[];

/** The ways out as prose: each label as a sentence, every one after the first after "Or:". */
export function adviceText(advice: RunnerAdvice): string {
  return advice.map(({ label }, index) => (index === 0 ? `${label}.` : `Or: ${label}.`)).join(' ');
}
