import { UNBOUND_DOMAIN_NAMESPACE_ID } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { resolveStatements } from '../../../src/control-api/statements/resolve-statements';
import { renameStatements } from '../../../src/control-api/statements/statement-text';
import { contractOf, expectFailure, expectValue } from './statement-fixtures';

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

const profileToUser = {
  origin: contractOf({ app: { models: { Profile: {}, Post: {} } } }),
  destination: contractOf({ app: { models: { User: {}, Post: {} } } }),
};

describe('resolveStatements, model renames', () => {
  it('resolves a bare model through the sole namespace', () => {
    const { origin, destination } = profileToUser;
    expect(expectValue(resolve(['Profile:User'], origin, destination))).toEqual([
      {
        kind: 'rename',
        entity: 'model',
        from: { namespaceId: 'app', model: 'Profile' },
        to: { namespaceId: 'app', model: 'User' },
      },
    ]);
  });

  it('resolves a rename that changes namespace and name', () => {
    const origin = contractOf({ auth: { models: { Profile: {} } }, billing: {} });
    const destination = contractOf({ auth: {}, billing: { models: { User: {} } } });
    expect(expectValue(resolve(['auth.Profile:billing.User'], origin, destination))).toEqual([
      {
        kind: 'rename',
        entity: 'model',
        from: { namespaceId: 'auth', model: 'Profile' },
        to: { namespaceId: 'billing', model: 'User' },
      },
    ]);
  });

  it('keeps the order the statements were given in', () => {
    const origin = contractOf({ app: { models: { Profile: {}, Post: {} } } });
    const destination = contractOf({ app: { models: { User: {}, Article: {} } } });
    const resolved = expectValue(resolve(['Post:Article', 'Profile:User'], origin, destination));
    expect(resolved.map((statement) => statement.to.model)).toEqual(['Article', 'User']);
  });

  it('returns no statements when none are given', () => {
    const { origin, destination } = profileToUser;
    expect(expectValue(resolve([], origin, destination))).toEqual([]);
  });

  describe('names that do not resolve', () => {
    it('refuses an old name the origin does not have, naming the models it has', () => {
      const { origin, destination } = profileToUser;
      expectFailure(
        resolve(['Account:User'], origin, destination),
        UNRESOLVED,
        'Account:User',
        'origin contract',
        'app.Post',
        'app.Profile',
      );
    });

    it('lists at most twenty models when the old name is missing', () => {
      const models = Object.fromEntries(
        Array.from({ length: 25 }, (_, i) => [`M${String(i).padStart(2, '0')}`, {}]),
      );
      const failure = expectFailure(
        resolve(['Account:User'], contractOf({ app: { models } }), profileToUser.destination),
        UNRESOLVED,
        'app.M00',
        'app.M19',
        'and 5 more',
      );
      expect(failure.why).not.toContain('app.M20');
    });

    it('refuses a new name the destination does not have, naming the models it has', () => {
      const { origin, destination } = profileToUser;
      expectFailure(
        resolve(['Profile:Account'], origin, destination),
        UNRESOLVED,
        'destination contract',
        'app.Post',
        'app.User',
      );
    });

    it('refuses a new name the origin already has', () => {
      const origin = contractOf({ app: { models: { Profile: {}, User: {} } } });
      const destination = contractOf({ app: { models: { User: {} } } });
      expectFailure(
        resolve(['Profile:User'], origin, destination),
        UNRESOLVED,
        '"app.User" already exists in the origin contract',
      );
    });

    it('refuses an old name the destination still has', () => {
      const origin = contractOf({ app: { models: { Profile: {} } } });
      const destination = contractOf({ app: { models: { Profile: {}, User: {} } } });
      expectFailure(
        resolve(['Profile:User'], origin, destination),
        UNRESOLVED,
        '"app.Profile" still exists in the destination contract',
      );
    });

    it('refuses the second half of a swap, because resolution reads the contracts', () => {
      const origin = contractOf({ app: { models: { A: {} } } });
      const destination = contractOf({ app: { models: { B: {} } } });
      expectFailure(resolve(['A:B', 'B:A'], origin, destination), UNRESOLVED, '--rename B:A');
    });

    it('matches names exactly, including case', () => {
      const origin = contractOf({ app: { models: { user: {} } } });
      const destination = contractOf({ app: { models: { User: {} } } });
      expect(expectValue(resolve(['user:User'], origin, destination))).toHaveLength(1);
      expectFailure(resolve(['User:User'], origin, destination), UNRESOLVED, 'origin contract');
    });
  });

  describe('namespaces', () => {
    it('refuses a bare name several namespaces declare, listing the qualified candidates', () => {
      const origin = contractOf({
        auth: { models: { User: {} } },
        billing: { models: { User: {} } },
      });
      const destination = contractOf({
        auth: { models: { Account: {} } },
        billing: { models: { User: {} } },
      });
      const failure = expectFailure(
        resolve(['User:Account'], origin, destination),
        UNRESOLVED,
        'auth.User',
        'billing.User',
      );
      expect(failure.fix).toBe('Name the model with its namespace, for example auth.User.');
    });

    it('does not prefer the default namespace for a bare name', () => {
      const origin = contractOf({
        [UNBOUND_DOMAIN_NAMESPACE_ID]: { models: { User: {} } },
        auth: { models: { User: {} } },
      });
      const destination = contractOf({
        [UNBOUND_DOMAIN_NAMESPACE_ID]: { models: { Account: {} } },
        auth: { models: { User: {} } },
      });
      expectFailure(
        resolve(['User:Account'], origin, destination),
        UNRESOLVED,
        `${UNBOUND_DOMAIN_NAMESPACE_ID}.User`,
        'auth.User',
      );
    });

    it('refuses a two-segment side that resolves both as namespace.Model and as Model.field', () => {
      const origin = contractOf({
        a: { models: { b: {} } },
        app: { models: { a: { fields: ['b'] } } },
      });
      const destination = contractOf({
        a: { models: { c: {} } },
        app: { models: { a: { fields: ['c'] } } },
      });
      expectFailure(
        resolve(['a.b:a.c'], origin, destination),
        UNRESOLVED,
        'namespace "a" model "b"',
        'model "a" field "b"',
      );
    });

    it('refuses a two-segment side that resolves neither way, naming both attempts', () => {
      const { origin, destination } = profileToUser;
      expectFailure(
        resolve(['x.y:User'], origin, destination),
        UNRESOLVED,
        'as namespace.Model',
        'no namespace "x"',
        'as Model.field',
        'no model "x"',
      );
    });
  });

  describe('depth', () => {
    it('refuses a model renamed to something that resolves as a field', () => {
      const origin = contractOf({ app: { models: { Profile: {} } } });
      const destination = contractOf({ app: { models: { User: { fields: ['name'] } } } });
      expectFailure(
        resolve(['Profile:User.name'], origin, destination),
        INVALID,
        'model on one side and a field on the other',
      );
    });
  });

  describe('entity kinds', () => {
    it('resolves a variant like any model', () => {
      const origin = contractOf({ app: { models: { Pet: {}, Dog: { base: 'Pet' } } } });
      const destination = contractOf({ app: { models: { Pet: {}, Hound: { base: 'Pet' } } } });
      expect(expectValue(resolve(['Dog:Hound'], origin, destination))).toEqual([
        {
          kind: 'rename',
          entity: 'model',
          from: { namespaceId: 'app', model: 'Dog' },
          to: { namespaceId: 'app', model: 'Hound' },
        },
      ]);
    });

    it('refuses a value object, saying value object renames are not supported', () => {
      const origin = contractOf({ app: { valueObjects: { Address: ['street'] } } });
      const destination = contractOf({ app: { valueObjects: { Location: ['street'] } } });
      const failure = expectFailure(
        resolve(['Address:Location'], origin, destination),
        UNRESOLVED,
        'value object renames are not supported in this release',
      );
      expect(failure.fix).toBe('Leave value objects and their fields out of the statements.');
    });
  });

  describe('repeated names across statements', () => {
    it('refuses renaming two models to the same name', () => {
      const origin = contractOf({ app: { models: { A: {}, C: {} } } });
      const destination = contractOf({ app: { models: { B: {} } } });
      const failure = expectFailure(
        resolve(['A:B', 'C:B'], origin, destination),
        INVALID,
        '--rename C:B',
        'already renames a model to "app.B"',
      );
      expect(failure.fix).not.toContain('namespace.Model.field');
    });

    it('refuses renaming one model twice', () => {
      const origin = contractOf({ app: { models: { A: {} } } });
      const destination = contractOf({ app: { models: { B: {}, C: {} } } });
      expectFailure(
        resolve(['A:B', 'A:C'], origin, destination),
        INVALID,
        'already renames "app.A"',
      );
    });
  });
});

describe('resolveStatements, origin contract unknown', () => {
  const destination = contractOf({ app: { models: { User: {} } } });

  it('refuses before reading any statement, naming the hash and the directory', () => {
    const result = resolveStatements({
      statements: renameStatements(['not a statement']),
      origin: {
        kind: 'missing',
        hash: 'sha256:abc',
        snapshotDirectory: 'migrations/snapshots',
        unreadable: undefined,
      },
      destination,
    });
    expectFailure(
      result,
      'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      'sha256:abc',
      'migrations/snapshots',
    );
  });

  it('says there is no marker when there is no hash to look for', () => {
    const result = resolveStatements({
      statements: renameStatements(['Profile:User']),
      origin: {
        kind: 'missing',
        hash: null,
        snapshotDirectory: 'migrations/snapshots',
        unreadable: undefined,
      },
      destination,
    });
    expectFailure(result, 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN', 'no marker', 'no earlier contract');
  });

  it('resolves to no statements when none are given', () => {
    const result = resolveStatements({
      statements: renameStatements([]),
      origin: {
        kind: 'missing',
        hash: null,
        snapshotDirectory: 'migrations/snapshots',
        unreadable: undefined,
      },
      destination,
    });
    expect(expectValue(result)).toEqual([]);
  });
});
