import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { planStatements } from '../src/core/migrations/statement-planning';
import {
  ALL_CLASSES,
  contractOf,
  fakeTarget,
  planned,
  rejection,
  renameField,
  renameModel,
} from './statement-fixtures';

const invoiceInApp = contractOf({ Invoice: { table: 'Invoice', fields: { total: 'total' } } });
const invoiceInBilling = contractOf({
  Invoice: { table: 'Invoice', namespace: 'billing', fields: { total: 'total' } },
});
const moveInvoice = renameModel('Invoice', 'Invoice', 'app', 'billing');

describe('a model moved to another namespace', () => {
  it('moves its table through the target, and applies the move to the working schema', () => {
    const target = fakeTarget(['app.Invoice']);

    const result = planStatements({
      statements: [moveInvoice],
      fromContract: invoiceInApp,
      contract: invoiceInBilling,
      policy: ALL_CLASSES,
      target,
    });

    expect(planned(result)).toMatchObject({
      calls: ['move app.Invoice -> billing'],
      plannedStatements: [
        { statement: moveInvoice, operations: { kind: 'planned', operationIndexes: [0] } },
      ],
    });
    expect(target.tables().hasTable('billing', 'Invoice')).toBe(true);
    expect(target.tables().hasTable('app', 'Invoice')).toBe(false);
  });

  it('creates the destination namespace first when the working schema lacks it, and the statement accounts for the move only', () => {
    const result = planStatements({
      statements: [moveInvoice],
      fromContract: invoiceInApp,
      contract: invoiceInBilling,
      policy: ALL_CLASSES,
      target: fakeTarget(['app.Invoice'], {}, ['widening'], undefined, ['app']),
    });

    expect(planned(result)).toMatchObject({
      calls: ['namespace billing', 'move app.Invoice -> billing'],
      plannedStatements: [
        { statement: moveInvoice, operations: { kind: 'planned', operationIndexes: [1] } },
      ],
    });
  });

  it('moves the table and then renames it in the destination, the rename computed against the moved table', () => {
    const statement = renameModel('Invoice', 'Bill', 'app', 'billing');

    const result = planStatements({
      statements: [statement],
      fromContract: invoiceInApp,
      contract: contractOf({ Bill: { table: 'Bill', namespace: 'billing' } }),
      policy: ALL_CLASSES,
      target: fakeTarget(['app.Invoice']),
    });

    expect(planned(result)).toMatchObject({
      calls: ['move app.Invoice -> billing', 'table billing.Invoice -> Bill'],
      tableRenames: [{ namespaceId: 'billing', from: 'Invoice', to: 'Bill' }],
      plannedStatements: [
        { statement, operations: { kind: 'planned', operationIndexes: [0, 1, 2] } },
      ],
    });
  });

  it('names a field of the moved model on the table in its new namespace', () => {
    const fieldRename = renameField('Invoice', 'total', 'amount', 'Invoice', 'app', 'billing');

    const result = planStatements({
      statements: [moveInvoice, fieldRename],
      fromContract: invoiceInApp,
      contract: contractOf({
        Invoice: { table: 'Invoice', namespace: 'billing', fields: { amount: 'amount' } },
      }),
      policy: ALL_CLASSES,
      target: fakeTarget(['app.Invoice'], { 'app.Invoice': ['total'] }),
    });

    expect(planned(result).calls).toEqual([
      'move app.Invoice -> billing',
      'column billing.Invoice.total -> amount',
    ]);
  });

  it('refuses a move onto a table the destination namespace already has, naming it', () => {
    const conflict = rejection(
      planStatements({
        statements: [moveInvoice],
        fromContract: invoiceInApp,
        contract: invoiceInBilling,
        policy: ALL_CLASSES,
        target: fakeTarget(['app.Invoice', 'billing.Invoice']),
      }),
    );

    expect(conflict).toMatchObject({
      kind: 'statementRefused',
      summary:
        'Cannot move table "Invoice" from namespace "app" to namespace "billing": the schema being planned from already has a table "billing.Invoice"',
      why: 'A move cannot replace a table that already exists. Rename, move or drop table "billing.Invoice" first, or leave out this statement.',
      location: { namespaceId: 'billing', entityKind: 'table', entityName: 'Invoice' },
    });
  });

  it('refuses a move whose table the schema being planned from does not have', () => {
    const conflict = rejection(
      planStatements({
        statements: [moveInvoice],
        fromContract: invoiceInApp,
        contract: invoiceInBilling,
        policy: ALL_CLASSES,
        target: fakeTarget([]),
      }),
    );

    expect(conflict.summary).toBe(
      'Cannot move table "Invoice" from namespace "app" to namespace "billing": the schema being planned from has no table "app.Invoice"',
    );
  });

  it('refuses a move with a rename onto a name the destination namespace already has', () => {
    const conflict = rejection(
      planStatements({
        statements: [renameModel('Invoice', 'Bill', 'app', 'billing')],
        fromContract: invoiceInApp,
        contract: contractOf({ Bill: { table: 'Bill', namespace: 'billing' } }),
        policy: ALL_CLASSES,
        target: fakeTarget(['app.Invoice', 'billing.Bill']),
      }),
    );

    expect(conflict.summary).toBe(
      'Cannot move table "Invoice" from namespace "app" to namespace "billing": the schema being planned from already has a table "billing.Bill"',
    );
  });

  it('refuses a move into a table whose control policy is not managed, as a rename is refused', () => {
    const conflict = rejection(
      planStatements({
        statements: [moveInvoice],
        fromContract: invoiceInApp,
        contract: contractOf({
          Invoice: { table: 'Invoice', namespace: 'billing', control: 'external' },
        }),
        policy: ALL_CLASSES,
        target: fakeTarget(['app.Invoice']),
      }),
    );

    expect(conflict).toMatchObject({
      summary:
        'Cannot move table "Invoice" from namespace "app" to namespace "billing": the table\'s control policy is "external"',
      why: 'Statements rename only tables, and columns of tables, whose control policy is "managed"; table "Invoice" is "external". Make the change in the database yourself and leave out this statement.',
    });
  });

  it('refuses a move whose operation class the plan does not allow, as a rename is refused', () => {
    const conflict = rejection(
      planStatements({
        statements: [moveInvoice],
        fromContract: invoiceInApp,
        contract: invoiceInBilling,
        policy: { allowedOperationClasses: ['additive'] },
        target: fakeTarget(['app.Invoice']),
      }),
    );

    expect(conflict).toMatchObject({
      summary:
        'Cannot move table "Invoice" from namespace "app" to namespace "billing": the plan does not allow "widening" operations',
      refusedOperationClass: 'widening',
    });
  });

  it('refuses a move into the unbound namespace, which has no fixed place in the database', () => {
    const conflict = rejection(
      planStatements({
        statements: [renameModel('Invoice', 'Invoice', 'app', UNBOUND_NAMESPACE_ID)],
        fromContract: invoiceInApp,
        contract: contractOf({ Invoice: { table: 'Invoice', namespace: UNBOUND_NAMESPACE_ID } }),
        policy: ALL_CLASSES,
        target: fakeTarget(['app.Invoice']),
      }),
    );

    expect(conflict).toMatchObject({
      summary:
        'Cannot move table "Invoice" from namespace "app" to the unbound namespace: the unbound namespace has no fixed place in the database',
      why: 'A table of the unbound namespace lives wherever the connection that uses it looks, so a migration cannot move a table there. Move the table yourself and leave out this statement, or keep the model in namespace "app".',
    });
  });

  it('names the unbound namespace in words, never by its internal id', () => {
    const conflict = rejection(
      planStatements({
        statements: [renameModel('Invoice', 'Invoice', UNBOUND_NAMESPACE_ID, 'billing')],
        fromContract: contractOf({
          Invoice: { table: 'Invoice', namespace: UNBOUND_NAMESPACE_ID },
        }),
        contract: invoiceInBilling,
        policy: ALL_CLASSES,
        target: fakeTarget([`${UNBOUND_NAMESPACE_ID}.Invoice`, 'billing.Invoice']),
      }),
    );

    expect(conflict.summary).toBe(
      'Cannot move table "Invoice" from the unbound namespace to namespace "billing": the schema being planned from already has a table "billing.Invoice"',
    );
  });
});
