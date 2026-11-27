import type { EngineEvent } from '@prisma/cli-engine';

/** The line a command that changes the database prints when it brought Prisma's own tables up to date first. */
export function reportPrismaSpaceApplied(report: (event: EngineEvent) => void): void {
  report({
    kind: 'message',
    severity: 'info',
    text: "Prisma's own tables in this database were brought up to date.",
  });
}
