import { describe, expect, it } from 'vitest';
import { planStatements } from '../src/core/migrations/statement-planning';
import {
  ALL_CLASSES,
  contractOf,
  fakeTarget,
  planned,
  refusingNamespaceRenames,
  rejection,
  renameField,
  renameModel,
  renameNamespace,
  withoutNamespaces,
} from './statement-fixtures';

const inBilling = contractOf({
  Invoice: { table: 'Invoice', namespace: 'billing', fields: { total: 'total' } },
});
const inFinance = contractOf({
  Invoice: { table: 'Invoice', namespace: 'finance', fields: { total: 'total' } },
});
const statement = renameNamespace('billing', 'finance');

describe('a namespace rename', () => {
  it('renames the namespace through the target, and applies it to the working schema', () => {
    const target = fakeTarget(['billing.Invoice']);

    const result = planStatements({
      statements: [statement],
      fromContract: inBilling,
      contract: inFinance,
      policy: ALL_CLASSES,
      target,
    });

    expect(planned(result)).toMatchObject({
      calls: ['rename-namespace billing -> finance'],
      plannedStatements: [{ statement, operations: { kind: 'planned', operationIndexes: [0] } }],
    });
    expect(target.tables().hasTable('finance', 'Invoice')).toBe(true);
  });

  it('names the tables of the renamed namespace by their new namespace in later statements', () => {
    const result = planStatements({
      statements: [
        statement,
        renameModel('Invoice', 'Bill', 'billing', 'finance'),
        renameField('Invoice', 'total', 'amount', 'Bill', 'billing', 'finance'),
      ],
      fromContract: inBilling,
      contract: contractOf({
        Bill: { table: 'Bill', namespace: 'finance', fields: { amount: 'amount' } },
      }),
      policy: ALL_CLASSES,
      target: fakeTarget(['billing.Invoice'], { 'billing.Invoice': ['total'] }),
    });

    expect(planned(result).calls).toEqual([
      'rename-namespace billing -> finance',
      'table finance.Invoice -> Bill',
      'column finance.Bill.total -> amount',
    ]);
  });

  it('refuses what the target refuses, in its words', () => {
    const conflict = rejection(
      planStatements({
        statements: [statement],
        fromContract: inBilling,
        contract: inFinance,
        policy: ALL_CLASSES,
        target: refusingNamespaceRenames(fakeTarget(['billing.Invoice']), {
          reason: 'it is the default namespace',
          fix: 'Move the models instead.',
        }),
      }),
    );

    expect(conflict).toMatchObject({
      kind: 'statementRefused',
      summary: 'Cannot rename namespace "billing" to "finance": it is the default namespace',
      why: 'Move the models instead.',
      refusedStatement: statement,
    });
  });

  it('refuses a namespace with a table whose control policy is not managed', () => {
    const conflict = rejection(
      planStatements({
        statements: [statement],
        fromContract: inBilling,
        contract: contractOf({
          Invoice: { table: 'Invoice', namespace: 'finance', control: 'external' },
        }),
        policy: ALL_CLASSES,
        target: fakeTarget(['billing.Invoice']),
      }),
    );

    expect(conflict).toMatchObject({
      summary:
        'Cannot rename namespace "billing" to "finance": table "Invoice" has control policy "external"',
      why: 'Statements rename only namespaces whose tables all have control policy "managed"; table "Invoice" is "external". Make the change in the database yourself and leave out this statement.',
    });
  });

  it('refuses a namespace the schema being planned from does not have', () => {
    expect(
      rejection(
        planStatements({
          statements: [statement],
          fromContract: inBilling,
          contract: inFinance,
          policy: ALL_CLASSES,
          target: fakeTarget([]),
        }),
      ).summary,
    ).toBe(
      'Cannot rename namespace "billing" to "finance": the schema being planned from has no namespace "billing"',
    );
  });

  it('refuses a new name the schema being planned from already has', () => {
    const conflict = rejection(
      planStatements({
        statements: [statement],
        fromContract: inBilling,
        contract: inFinance,
        policy: ALL_CLASSES,
        target: fakeTarget(['billing.Invoice', 'finance.Other']),
      }),
    );

    expect(conflict).toMatchObject({
      summary:
        'Cannot rename namespace "billing" to "finance": the database already has a namespace "finance"',
      why: 'The database already has a namespace "finance", which the contract it was last updated to does not declare. If it holds nothing, drop or rename it in the database yourself; otherwise move each model with --rename billing.<Model>:finance.<Model> instead of this statement.',
    });
  });

  it('refuses a rename whose operation class the plan does not allow', () => {
    expect(
      rejection(
        planStatements({
          statements: [statement],
          fromContract: inBilling,
          contract: inFinance,
          policy: { allowedOperationClasses: ['additive'] },
          target: fakeTarget(['billing.Invoice']),
        }),
      ),
    ).toMatchObject({ refusedOperationClass: 'widening' });
  });

  it('plans namespace renames first, so the order the statements are given in does not matter', () => {
    const modelStatement = renameModel('Invoice', 'Bill', 'billing', 'finance');
    const planIn = (
      statements: readonly ReturnType<typeof renameModel | typeof renameNamespace>[],
    ) =>
      planned(
        planStatements({
          statements,
          fromContract: inBilling,
          contract: contractOf({ Bill: { table: 'Bill', namespace: 'finance' } }),
          policy: ALL_CLASSES,
          target: fakeTarget(['billing.Invoice']),
        }),
      ).calls;

    expect(planIn([modelStatement, statement])).toEqual([
      'rename-namespace billing -> finance',
      'table finance.Invoice -> Bill',
    ]);
    expect(planIn([statement, modelStatement])).toEqual(planIn([modelStatement, statement]));
  });

  it('reports where each origin table and column now is, read the other way round', () => {
    const result = planStatements({
      statements: [
        statement,
        renameModel('Invoice', 'Bill', 'billing', 'finance'),
        renameField('Invoice', 'total', 'amount', 'Bill', 'billing', 'finance'),
      ],
      fromContract: inBilling,
      contract: contractOf({
        Bill: { table: 'Bill', namespace: 'finance', fields: { amount: 'amount' } },
      }),
      policy: ALL_CLASSES,
      target: fakeTarget(['billing.Invoice', 'billing.Other'], { 'billing.Invoice': ['total'] }),
    });
    if (!result.ok) throw new Error(result.failure.summary);
    const { origins } = result.value;
    const origin = { namespaceId: 'billing', table: 'Invoice' };

    expect({
      moved: origins.originTable({ namespaceId: 'finance', table: 'Bill' }),
      untouched: origins.originTable({ namespaceId: 'finance', table: 'Other' }),
      column: origins.originColumn(origin, 'amount'),
    }).toEqual({
      moved: origin,
      untouched: { namespaceId: 'billing', table: 'Other' },
      column: 'total',
    });
  });
});

describe('a namespace rename refused by the family', () => {
  it('refuses a namespace another contract space declares, naming the space', () => {
    const conflict = rejection(
      planStatements({
        statements: [statement],
        fromContract: inBilling,
        contract: inFinance,
        policy: ALL_CLASSES,
        target: fakeTarget(['billing.Invoice']),
        ownership: {
          oracle: {
            declaresEntity: () => false,
            namespaceDeclaringSpaces: (namespaceId) =>
              namespaceId === 'billing' ? ['app', 'ledger'] : ['app'],
          },
          spaceId: 'app',
        },
      }),
    );

    expect(conflict).toMatchObject({
      summary:
        'Cannot rename namespace "billing" to "finance": contract space "ledger" also declares it',
      why: 'Renaming the namespace would rename it under contract space "ledger" too, whose contract still names it "billing". Leave out this statement, or move each model with --rename billing.<Model>:finance.<Model> instead.',
    });
  });

  it('refuses a namespace rename for a target without namespaces', () => {
    const conflict = rejection(
      planStatements({
        statements: [statement],
        fromContract: inBilling,
        contract: inFinance,
        policy: ALL_CLASSES,
        target: withoutNamespaces(fakeTarget(['billing.Invoice'])),
      }),
    );

    expect(conflict).toMatchObject({
      summary:
        'Cannot rename namespace "billing" to "finance": the database target keeps every table in one namespace',
      why: 'This database target has no namespaces, so a statement cannot rename a namespace or move a model to another one. Leave out this statement.',
    });
  });

  it('refuses a model move for a target without namespaces', () => {
    const conflict = rejection(
      planStatements({
        statements: [renameModel('Invoice', 'Invoice', 'billing', 'finance')],
        fromContract: inBilling,
        contract: inFinance,
        policy: ALL_CLASSES,
        target: withoutNamespaces(fakeTarget(['billing.Invoice'])),
      }),
    );

    expect(conflict).toMatchObject({
      summary:
        'Cannot move table "Invoice" from namespace "billing" to namespace "finance": the database target keeps every table in one namespace',
      why: 'This database target has no namespaces, so a statement cannot rename a namespace or move a model to another one. Leave out this statement.',
    });
  });
});
