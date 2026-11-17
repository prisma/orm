import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { resolveStatements } from '../../../src/control-api/statements/resolve-statements';
import { renameStatements } from '../../../src/control-api/statements/statement-text';
import { contractOf, expectFailure } from './statement-fixtures';

const UNRESOLVED = 'MIGRATION.STATEMENT_UNRESOLVED';
const INVALID = 'MIGRATION.STATEMENT_INVALID';

function resolve(
  renames: readonly string[],
  origin: ReturnType<typeof contractOf>,
  destination: ReturnType<typeof contractOf>,
) {
  return resolveStatements({
    statements: renameStatements(renames),
    origin: { kind: 'contract', contract: origin },
    destination,
  });
}

function unbound(models: Record<string, readonly string[]>) {
  return contractOf({
    [UNBOUND_NAMESPACE_ID]: {
      models: Object.fromEntries(
        Object.entries(models).map(([name, fields]) => [name, { fields }]),
      ),
    },
  });
}

const profile = unbound({ Profile: ['id', 'name', 'handle'], Post: ['id'] });
const user = unbound({ User: ['id', 'fullName', 'handle'], Post: ['id'] });

function adviceOf(result: ReturnType<typeof resolve>, code: string) {
  const failure = expectFailure(result, code);
  return { why: failure.why, fix: failure.fix };
}

describe('statement errors say what to type', () => {
  it('says a statement the database has already applied should be left out', () => {
    expect(adviceOf(resolve(['Profile:User'], user, user), UNRESOLVED)).toEqual({
      why: 'The origin contract already has "User" and has no "Profile", so this rename has already happened. For db update, the database is already at the new name.',
      fix: 'Leave out --rename Profile:User.',
    });
  });

  it('says the same for a field statement that has already been applied', () => {
    expect(adviceOf(resolve(['User.name:User.fullName'], user, user), UNRESOLVED).fix).toBe(
      'Leave out --rename User.name:User.fullName.',
    );
  });

  it('writes a backwards statement the right way round', () => {
    expect(adviceOf(resolve(['User:Profile'], profile, user), UNRESOLVED)).toEqual({
      why: 'The statement is the wrong way round: "Profile" is the old name, in the origin contract, and "User" the new name, in the destination contract.',
      fix: 'Write the old name first: --rename Profile:User.',
    });
  });

  it('refuses a field swap and gives the three plans that make it', () => {
    const origin = unbound({ Profile: ['id', 'name', 'handle'] });
    expect(
      adviceOf(
        resolve(['Profile.name:Profile.handle', 'Profile.handle:Profile.name'], origin, origin),
        INVALID,
      ),
    ).toEqual({
      why: '"Profile.name" and "Profile.handle" swap names: each is both an old name and a new name, and statements cannot swap names in one plan.',
      fix: 'Make the swap in three plans. First change the contract so that "Profile.name" has a temporary name, and plan it with --rename Profile.name:Profile.<temporary name>. Then give "Profile.handle" the name "Profile.name", and plan it with --rename Profile.handle:Profile.name. Then give the temporary name the name "Profile.handle", and plan it with --rename Profile.<temporary name>:Profile.handle.',
    });
  });

  it('advises three plans whose statements each resolve against their contracts', () => {
    const contracts = [
      unbound({ Profile: ['id', 'name', 'handle'] }),
      unbound({ Profile: ['id', 'tmp', 'handle'] }),
      unbound({ Profile: ['id', 'tmp', 'name'] }),
      unbound({ Profile: ['id', 'handle', 'name'] }),
    ];
    const [first] = contracts;
    if (first === undefined) throw new Error('expected contracts');
    const fix = adviceOf(
      resolve(['Profile.name:Profile.handle', 'Profile.handle:Profile.name'], first, first),
      INVALID,
    ).fix;
    const advised = [
      ...(fix ?? '').replaceAll('<temporary name>', 'tmp').matchAll(/--rename (\S+?)\.(?:\s|$)/g),
    ].map((match) => match[1] ?? '');
    expect(advised).toEqual([
      'Profile.name:Profile.tmp',
      'Profile.handle:Profile.name',
      'Profile.tmp:Profile.handle',
    ]);
    advised.forEach((statement, index) => {
      const [from, to] = [contracts[index], contracts[index + 1]];
      if (from === undefined || to === undefined) throw new Error('expected contracts');
      expect(resolve([statement], from, to).ok, statement).toBe(true);
    });
  });

  it('refuses a model swap the same way', () => {
    const origin = unbound({ Profile: ['id'], User: ['id'] });
    expect(adviceOf(resolve(['Profile:User'], origin, origin), INVALID).why).toContain(
      'swap names',
    );
  });

  it('says a model renamed to itself renames nothing, and what to do when only its stored name changed', () => {
    expect(adviceOf(resolve(['Profile:Profile'], profile, profile), INVALID)).toEqual({
      why: 'The statement renames model "Profile" to itself.',
      fix: 'Leave out --rename Profile:Profile. If only the stored name changed (@map or @@map), a statement cannot state that in this release, and a plan without it drops and creates what the model or field is stored in, with its data. With migration plan, edit the planned migration.ts to rename the stored name instead of dropping and creating it. With db update, rename it in the database yourself first, then run db update, which then finds nothing that loses data.',
    });
  });

  it('says a field renamed to itself renames nothing, and what to do when only its stored name changed', () => {
    expect(adviceOf(resolve(['Profile.name:Profile.name'], profile, profile), INVALID).fix).toBe(
      'Leave out --rename Profile.name:Profile.name. If only the stored name changed (@map or @@map), a statement cannot state that in this release, and a plan without it drops and creates what the model or field is stored in, with its data. With migration plan, edit the planned migration.ts to rename the stored name instead of dropping and creating it. With db update, rename it in the database yourself first, then run db update, which then finds nothing that loses data.',
    );
  });

  it('puts a model statement given after its field statement first', () => {
    const origin = unbound({ Profile: ['id', 'name'] });
    const destination = unbound({ Account: ['id', 'fullName'] });
    const advice = adviceOf(
      resolve(['Account.name:Account.fullName', 'Profile:Account'], origin, destination),
      UNRESOLVED,
    );
    expect(advice.fix).toBe(
      'Put --rename Profile:Account before --rename Account.name:Account.fullName.',
    );
    expect(advice.why).not.toContain('namespace.Model');
  });

  it('writes both statements a mix of model and field may have meant', () => {
    expect(adviceOf(resolve(['Profile:User.fullName'], profile, user), INVALID).fix).toBe(
      "To rename the model, write --rename Profile:User. To rename a field, write --rename User.<old field>:User.fullName, naming the field's model as the new contract names it.",
    );
  });
});

describe('statement errors in a contract with no namespaces', () => {
  it.each([
    ['Nope:User', profile, user],
    ['Profile:User', user, user],
    ['Account.name:Account.fullName', profile, user],
    ['Profile:User', profile, unbound({ Profile: ['id'], User: ['id'] })],
  ])('never show the internal namespace id (%s)', (text, origin, destination) => {
    const result = resolve([text], origin, destination);
    if (result.ok) throw new Error('expected a failure');
    const envelope = result.failure.toEnvelope();
    expect(JSON.stringify(envelope)).not.toContain(UNBOUND_NAMESPACE_ID);
  });
});
