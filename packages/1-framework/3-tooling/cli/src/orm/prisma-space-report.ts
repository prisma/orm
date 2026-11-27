import type { EngineEvent } from '@prisma/cli-engine';

/** The line a command that changes the database prints when it brought the records Prisma keeps for itself up to date first. */
export function reportPrismaSpaceApplied(report: (event: EngineEvent) => void): void {
  report({
    kind: 'message',
    severity: 'info',
    text: 'The records Prisma keeps for itself in this database were brought up to date.',
  });
}
