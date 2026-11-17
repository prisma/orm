import { describe, expect, it } from 'vitest';
import { buildNextSteps, NO_DATABASE_STEP } from '../../../src/commands/init/output';
import { buildInitNextActions } from '../../../src/orm/init-blocks';

const scaffolded = {
  packagesInstalled: 'installed',
  contractEmitted: true,
  emitCommand: 'prisma contract emit',
  schemaPath: 'src/prisma/contract.prisma',
  prisma7: null,
} as const;

describe('init next steps for a project with no database yet', () => {
  it('names create-db right after the DATABASE_URL step for a PostgreSQL project', () => {
    const steps = buildNextSteps({ ...scaffolded, target: 'postgres' });

    expect(steps[0]).toBe('1. Set DATABASE_URL in your environment (export it or add it to .env).');
    expect(steps[1]).toBe(`2. ${NO_DATABASE_STEP}`);
    expect(steps).toHaveLength(5);
  });

  it('says what the database is, how long it lasts, and where the connection string goes', () => {
    expect(NO_DATABASE_STEP).toContain('`npx create-db@latest`');
    expect(NO_DATABASE_STEP).toContain('with no account');
    expect(NO_DATABASE_STEP).toContain('deleted after 24 hours unless claimed');
    expect(NO_DATABASE_STEP).toContain('in place of the placeholder');
  });

  it('keeps the step when the install was skipped and the contract is not emitted', () => {
    const steps = buildNextSteps({
      ...scaffolded,
      target: 'postgres',
      packagesInstalled: 'skipped',
      contractEmitted: false,
    });

    expect(steps[1]).toMatch(/^2\. Set DATABASE_URL/);
    expect(steps[2]).toBe(`3. ${NO_DATABASE_STEP}`);
  });

  it('leaves the MongoDB steps as they were', () => {
    const steps = buildNextSteps({ ...scaffolded, target: 'mongodb' });

    expect(steps).toHaveLength(4);
    expect(steps.join('\n')).not.toContain('create-db');
  });

  it('leaves the Prisma 7 transition steps as they were', () => {
    const steps = buildNextSteps({
      ...scaffolded,
      target: 'postgres',
      prisma7: { packagesMoved: [], clientMoved: false },
    });

    expect(steps.join('\n')).not.toContain('create-db');
  });
});

describe('init typed next actions for a project with no database yet', () => {
  const inputs = { contractEmitted: true, schemaPath: 'src/prisma/contract.prisma' } as const;

  it('offers create-db as a choice right after the DATABASE_URL action', () => {
    const actions = buildInitNextActions({ ...inputs, target: 'postgres', prisma7: null });

    expect(actions[0]).toMatchObject({ label: expect.stringContaining('Set DATABASE_URL') });
    expect(actions[1]).toEqual({ kind: 'user-choice', label: NO_DATABASE_STEP });
  });

  it('never asks an agent to run create-db as a command', () => {
    const actions = buildInitNextActions({ ...inputs, target: 'postgres', prisma7: null });

    expect(actions.filter((action) => action.kind === 'run-command')).toEqual([
      expect.objectContaining({ command: 'prisma init' }),
    ]);
  });

  it('leaves MongoDB and Prisma 7 actions as they were', () => {
    const mongo = buildInitNextActions({ ...inputs, target: 'mongodb', prisma7: null });
    const prisma7 = buildInitNextActions({
      ...inputs,
      target: 'postgres',
      prisma7: { clientMoved: false },
    });

    expect(JSON.stringify([...mongo, ...prisma7])).not.toContain('create-db');
  });
});
