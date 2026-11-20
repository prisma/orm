import { describe, expect, it } from 'vitest';
import { resolveStatements } from '../../../src/control-api/statements/resolve-statements';
import { renameStatements } from '../../../src/control-api/statements/statement-text';
import { contractOf, expectFailure, expectValue, failureShape } from './statement-fixtures';

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

const billing = contractOf({ app: { models: { User: {} } }, billing: { models: { Invoice: {} } } });
const finance = contractOf({ app: { models: { User: {} } }, finance: { models: { Invoice: {} } } });

describe('resolveStatements, namespace renames', () => {
  it('reads one name as a namespace when the origin has it as a namespace and the destination the new one', () => {
    expect(expectValue(resolve(['billing:finance'], billing, finance))).toEqual([
      { kind: 'rename', entity: 'namespace', from: 'billing', to: 'finance' },
    ]);
  });

  it('still reads one name as a model when no namespace has it', () => {
    const origin = contractOf({ app: { models: { Profile: {} } }, billing: {} });
    const destination = contractOf({ app: { models: { User: {} } }, billing: {} });
    expect(expectValue(resolve(['Profile:User'], origin, destination))).toEqual([
      {
        kind: 'rename',
        entity: 'model',
        from: { namespaceId: 'app', model: 'Profile' },
        to: { namespaceId: 'app', model: 'User' },
      },
    ]);
  });

  it('refuses a statement that reads both as a namespace and as a model, and says how to name the model', () => {
    const origin = contractOf({
      app: { models: { billing: {} } },
      billing: { models: { Invoice: {} } },
    });
    const destination = contractOf({
      app: { models: { finance: {} } },
      finance: { models: { Invoice: {} } },
    });
    const failure = expectFailure(resolve(['billing:finance'], origin, destination), UNRESOLVED);
    expect({ why: failure.why, fix: failure.fix }).toEqual({
      why: '"billing:finance" reads both as a rename of namespace "billing" to "finance" and as a rename of model "app.billing" to "app.finance".',
      fix: 'To rename the model, name it with its namespace: --rename app.billing:app.finance. To rename both the namespace and the model, give both statements: --rename app.billing:app.finance --rename billing:finance.',
    });
  });

  it('on a re-run, says the origin has no namespace or model of the old name', () => {
    const failure = expectFailure(resolve(['billing:finance'], finance, finance), UNRESOLVED);
    expect(failure.why).toBe(
      'The origin contract has no namespace or model "billing" (namespaces: app, finance; models: app.User, finance.Invoice).',
    );
  });

  it('refuses a namespace the destination still has', () => {
    const both = contractOf({ billing: { models: { Invoice: {} } }, finance: {} });
    const failure = expectFailure(resolve(['billing:finance'], billing, both), UNRESOLVED);
    expect(failure.why).toBe(
      'Namespace "billing" still exists in the destination contract, so it was not renamed.',
    );
  });

  it('refuses a namespace the contract still has', () => {
    const failure = expectFailure(resolve(['billing:finance'], billing, billing), UNRESOLVED);
    expect(failure.why).toBe(
      'Namespace "billing" still exists in the destination contract, so it was not renamed.',
    );
  });

  it('refuses a new name the contract has as no namespace, naming the namespaces it adds and how to add it', () => {
    const elsewhere = contractOf({ app: { models: { User: {} } }, ledger: {} });
    expect(failureShape(resolve(['billing:finance'], billing, elsewhere))).toEqual({
      code: UNRESOLVED,
      summary: 'The contract has no namespace "finance" to rename "billing" to.',
      why: 'The contract adds namespace "ledger".',
      nextActions: [
        'If namespace "billing" was renamed to "finance", add namespace "finance" to the contract, run `{bin} contract emit`, and run this command again.',
        'If namespace "billing" was renamed to "ledger", use --rename billing:ledger in place of --rename billing:finance',
      ],
      meta: { statement: 'billing:finance', verb: 'rename' },
    });
  });

  it('refuses a new name the origin already has as a namespace', () => {
    const origin = contractOf({ billing: { models: { Invoice: {} } }, finance: {} });
    const destination = contractOf({ finance: { models: { Invoice: {} } } });
    expect(expectFailure(resolve(['billing:finance'], origin, destination), UNRESOLVED).why).toBe(
      'Namespace "finance" already exists in the origin contract, so it cannot be the new name of a namespace.',
    );
  });

  it('refuses a second rename of the same namespace', () => {
    const failure = expectFailure(
      resolve(['billing:finance', 'billing:finance'], billing, finance),
      INVALID,
    );
    expect(failure.why).toBe('An earlier statement already renames namespace "billing".');
  });

  it('reads one name as the namespace when another statement renames the model of that name, in either order', () => {
    const origin = contractOf({
      app: { models: { billing: {} } },
      billing: { models: { Invoice: {} } },
    });
    const destination = contractOf({
      app: { models: { finance: {} } },
      finance: { models: { Invoice: {} } },
    });
    const namespace = { kind: 'rename', entity: 'namespace', from: 'billing', to: 'finance' };
    const model = {
      kind: 'rename',
      entity: 'model',
      from: { namespaceId: 'app', model: 'billing' },
      to: { namespaceId: 'app', model: 'finance' },
    };

    expect(
      expectValue(resolve(['app.billing:app.finance', 'billing:finance'], origin, destination)),
    ).toEqual([model, namespace]);
    expect(
      expectValue(resolve(['billing:finance', 'app.billing:app.finance'], origin, destination)),
    ).toEqual([namespace, model]);
  });
});

describe('a rename to a missing name inside a renamed namespace', () => {
  const origin = contractOf({
    app: { models: { User: {} } },
    billing: {
      models: { Invoice: {} },
      enums: { Status: ['OLD'] },
      valueObjects: { Line: ['note'] },
    },
  });
  const destination = contractOf({
    app: { models: { User: {} } },
    finance: {
      models: { Invoice: {} },
      enums: { Status: ['NEW'] },
      valueObjects: { Line: ['label'] },
    },
  });

  it('offers the names the contract adds under the new namespace, and the offered rename resolves', () => {
    const offered = (text: string) =>
      failureShape(resolve(['billing:finance', text], origin, destination));

    expect({
      enumValue: offered('finance.Status.OLD:finance.Status.NOPE'),
      valueObjectField: offered('finance.Line.note:finance.Line.nope'),
      followed: expectValue(
        resolve(
          [
            'billing:finance',
            'finance.Status.OLD:finance.Status.NEW',
            'finance.Line.note:finance.Line.label',
          ],
          origin,
          destination,
        ),
      ).length,
    }).toEqual({
      enumValue: {
        code: UNRESOLVED,
        summary:
          'The contract has no enum value "finance.Status.NOPE" to rename "finance.Status.OLD" to.',
        why: 'The contract adds enum value "finance.Status.NEW".',
        nextActions: [
          'If enum value "finance.Status.OLD" was renamed to "finance.Status.NOPE", add enum value "finance.Status.NOPE" to the contract, run `{bin} contract emit`, and run this command again.',
          'If enum value "finance.Status.OLD" was renamed to "finance.Status.NEW", use --rename finance.Status.OLD:finance.Status.NEW in place of --rename finance.Status.OLD:finance.Status.NOPE',
        ],
        meta: { statement: 'finance.Status.OLD:finance.Status.NOPE', verb: 'rename' },
      },
      valueObjectField: {
        code: UNRESOLVED,
        summary:
          'The contract has no value object field "finance.Line.nope" to rename "finance.Line.note" to.',
        why: 'The contract adds value object field "finance.Line.label".',
        nextActions: [
          'If value object field "finance.Line.note" was renamed to "finance.Line.nope", add value object field "finance.Line.nope" to the contract, run `{bin} contract emit`, and run this command again.',
          'If value object field "finance.Line.note" was renamed to "finance.Line.label", use --rename finance.Line.note:finance.Line.label in place of --rename finance.Line.note:finance.Line.nope',
        ],
        meta: { statement: 'finance.Line.note:finance.Line.nope', verb: 'rename' },
      },
      followed: 3,
    });
  });
});
