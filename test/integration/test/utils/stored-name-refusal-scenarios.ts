/**
 * The refusal scenarios of a stored-name change, on PostgreSQL and SQLite: the contracts, the refusal, the two plans its advice gives, and the rows each table holds at the end.
 */

import { expect } from 'vitest';
import {
  type ExpectedConflict,
  emit,
  expectSettled,
  type PlannedOperation,
  planAndApply,
  planningFailure,
  refusal,
  rows,
  type StoredNameJourney,
  start,
  tableNames,
} from './stored-name-journeys';

export function models(user: string, account: string | undefined, member?: string): string {
  return `// use prisma-8

model User {
  id    Int    @id
  email String
  @@map("${user}")
}
${
  account === undefined
    ? ''
    : `
model Account {
  id   Int    @id
  plan String
  @@map("${account}")
}
`
}${
  member === undefined
    ? ''
    : `
model Member {
  id   Int    @id
  plan String
  @@map("${member}")
}
`
}`;
}

export function fields(lines: string): string {
  return `// use prisma-8

model User {
  id Int @id
${lines}
  @@map("users")
}
`;
}

export const MODELS_SEED = `INSERT INTO "users" (id, email) VALUES (1, 'alice@example.com'); INSERT INTO "accounts" (id, plan) VALUES (2, 'pro')`;
export const USER_ROW = { id: 1, email: 'alice@example.com' };
export const ACCOUNT_ROW = { id: 2, plan: 'pro' };

export interface AdviceStep {
  readonly psl: string;
  readonly args: readonly string[];
  readonly operations: readonly PlannedOperation[];
}

export interface RefusalScenario {
  readonly name: string;
  readonly from: string;
  readonly seed: string;
  readonly to: string;
  readonly args: readonly string[];
  readonly conflict: ExpectedConflict;
  readonly steps: readonly [AdviceStep, AdviceStep];
  readonly tables: Readonly<Record<string, readonly Record<string, unknown>[]>>;
}

/**
 * Plans the scenario's change and expects its refusal, whole and naming no statement; then follows the two plans of its advice as printed and reads every row back.
 */
export async function expectAdviceKeepsRows(
  journey: StoredNameJourney,
  scenario: RefusalScenario,
): Promise<void> {
  await start(journey, scenario.from, scenario.seed, '01');
  await emit(journey, scenario.to, '02');

  const refused = await refusal(journey, scenario.args, '03');
  expect(refused, '03: the refusal').toEqual(planningFailure(scenario.conflict));
  expect(JSON.stringify(refused), '03: the JSON error names no statement').not.toMatch(
    /refusedStatement|this statement/,
  );

  for (const [index, step] of scenario.steps.entries()) {
    const label = `0${4 + index}`;
    await emit(journey, step.psl, label);
    const planned = await planAndApply(journey, step.args, label);
    expect.soft(planned, `${label}: plan ${index + 1} of the advice`).toEqual(step.operations);
  }

  expect(await tableNames(journey), '06: the tables').toEqual(Object.keys(scenario.tables).sort());
  for (const [table, expected] of Object.entries(scenario.tables)) {
    expect(
      await rows(journey, `SELECT * FROM "${table}" ORDER BY id`),
      `06: the rows of ${table}`,
    ).toEqual(expected);
  }
  await expectSettled(journey, '07');
}
