/**
 * Steps shared by the Postgres journeys of enum value statements: `Task` has an optional `status` and a list `tags`, both typed by `Status`.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  sql,
} from './journey-test-helpers';

export function contractWith(members: string): string {
  return `// use prisma-8

enum Status {
  @@type("pg/text@1")
  ACTIVE = "active"
${members}}

model Task {
  id     Int      @id
  status Status?
  tags   Status[]
  @@map("task")
}
`;
}

export interface PlannedOperation {
  readonly label: string;
  readonly operationClass: string;
}

export async function emit(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emitted = await runContractEmit(ctx);
  expect(emitted.exitCode, `${label}: emit: ${emitted.stderr}`).toBe(0);
}

export async function tasks(connectionString: string): Promise<readonly unknown[]> {
  return (await sql(connectionString, 'SELECT id, status, tags FROM "task" ORDER BY id')).rows;
}

/** The database matches the contract, and `db update` finds nothing left to plan against it. */
export async function expectSettled(ctx: JourneyContext, label: string): Promise<void> {
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
  const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
  expect(dryRun.exitCode, `${label}: db update --dry-run: ${dryRun.stderr}`).toBe(0);
  expect(
    parseJsonOutput<{ plan: { operations: readonly PlannedOperation[] } }>(dryRun).plan.operations,
    `${label}: nothing left to plan`,
  ).toEqual([]);
}
