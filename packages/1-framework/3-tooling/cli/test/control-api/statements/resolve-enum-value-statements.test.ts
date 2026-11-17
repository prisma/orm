import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  renamedAndDeleted,
  resolveStatements,
} from '../../../src/control-api/statements/resolve-statements';
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

const app = asNamespaceId('app');
const origin = contractOf({
  app: {
    models: { Task: { fields: ['status'] } },
    enums: { Status: ['OPEN', 'ARCHIVED'], Priority: ['LOW', 'HIGH'] },
  },
});
const destination = contractOf({
  app: {
    models: { Task: { fields: ['status'] } },
    enums: { Status: ['OPEN', 'RETIRED'], Priority: ['LOW', 'HIGH'] },
  },
});

describe('resolveStatements, enum value renames', () => {
  it('reads Enum.value as a value of the enum', () => {
    expect(expectValue(resolve(['Status.ARCHIVED:Status.RETIRED'], origin, destination))).toEqual([
      {
        kind: 'rename',
        entity: 'enumValue',
        from: { namespaceId: app, enum: 'Status', member: 'ARCHIVED' },
        to: { namespaceId: app, enum: 'Status', member: 'RETIRED' },
      },
    ]);
  });

  it('reads namespace.Enum.value when several namespaces declare the enum', () => {
    const twoFrom = contractOf({
      public: { enums: { Status: ['OPEN', 'ARCHIVED'] } },
      billing: { enums: { Status: ['PAID'] } },
    });
    const twoTo = contractOf({
      public: { enums: { Status: ['OPEN', 'RETIRED'] } },
      billing: { enums: { Status: ['PAID'] } },
    });

    expect(
      expectValue(resolve(['public.Status.ARCHIVED:public.Status.RETIRED'], twoFrom, twoTo)),
    ).toEqual([
      {
        kind: 'rename',
        entity: 'enumValue',
        from: { namespaceId: asNamespaceId('public'), enum: 'Status', member: 'ARCHIVED' },
        to: { namespaceId: asNamespaceId('public'), enum: 'Status', member: 'RETIRED' },
      },
    ]);
    const failure = expectFailure(
      resolve(['Status.ARCHIVED:Status.RETIRED'], twoFrom, twoTo),
      UNRESOLVED,
    );
    expect(failure.why).toContain(
      '"Status" is an enum in more than one namespace of the origin contract (billing.Status, public.Status)',
    );
  });

  it('refuses a rename into another enum', () => {
    const failure = expectFailure(
      resolve(
        ['Status.ARCHIVED:Priority.MEDIUM'],
        origin,
        contractOf({
          app: {
            models: { Task: { fields: ['status'] } },
            enums: { Status: ['OPEN'], Priority: ['LOW', 'MEDIUM', 'HIGH'] },
          },
        }),
      ),
      INVALID,
    );
    expect({ why: failure.why, fix: failure.fix }).toEqual({
      why: 'The old name is a value of enum "Status" and the new name a value of enum "Priority"; a value cannot move between enums.',
      fix: 'Rename a value within one enum: --rename Status.ARCHIVED:Status.<new name>.',
    });
  });

  it('refuses an old value the destination still has, and a new one the origin already has', () => {
    expect(
      expectFailure(
        resolve(
          ['Status.OPEN:Status.RETIRED'],
          origin,
          contractOf({
            app: {
              models: { Task: { fields: ['status'] } },
              enums: { Status: ['OPEN', 'ARCHIVED', 'RETIRED'], Priority: ['LOW', 'HIGH'] },
            },
          }),
        ),
        UNRESOLVED,
      ).why,
    ).toBe(
      'The value "OPEN" still exists in the destination enum "Status", so it was not renamed.',
    );
    expect(
      expectFailure(resolve(['Status.ARCHIVED:Status.OPEN'], origin, destination), UNRESOLVED).why,
    ).toBe(
      'The value "OPEN" already exists in the origin enum "Status", so it cannot be the new name of a value.',
    );
  });

  it('names the values the enum has when the old one is missing', () => {
    expect(
      expectFailure(resolve(['Status.GONE:Status.RETIRED'], origin, destination), UNRESOLVED).why,
    ).toBe('The origin enum "Status" has no value "GONE" (values: ARCHIVED, OPEN).');
  });

  it('refuses a name that reads both as a field and as an enum value, naming both', () => {
    const both = (member: string) =>
      contractOf({
        app: { models: { Status: { fields: [member] } } },
        billing: { enums: { Status: [member] } },
      });
    const failure = expectFailure(
      resolve(['Status.ARCHIVED:Status.RETIRED'], both('ARCHIVED'), both('RETIRED')),
      UNRESOLVED,
    );
    expect(failure.why).toBe(
      '"Status.ARCHIVED" resolves both as model "Status" field "ARCHIVED" and as enum "Status" value "ARCHIVED".',
    );
    expect(failure.fix).toBe(
      'Name it with its namespace: app.Status.ARCHIVED for the field, billing.Status.ARCHIVED for the enum value.',
    );
  });

  it('renames a value of an enum whose namespace the same run renames, however the sides are written', () => {
    const billing = contractOf({
      app: { models: { Task: {} } },
      billing: { enums: { Status: ['OPEN', 'ARCHIVED'] } },
    });
    const finance = contractOf({
      app: { models: { Task: {} } },
      finance: { enums: { Status: ['OPEN', 'RETIRED'] } },
    });
    const expected = {
      kind: 'rename',
      entity: 'enumValue',
      from: { namespaceId: asNamespaceId('billing'), enum: 'Status', member: 'ARCHIVED' },
      to: { namespaceId: asNamespaceId('finance'), enum: 'Status', member: 'RETIRED' },
    };

    for (const text of [
      'Status.ARCHIVED:Status.RETIRED',
      'billing.Status.ARCHIVED:finance.Status.RETIRED',
      'finance.Status.ARCHIVED:finance.Status.RETIRED',
    ]) {
      expect(expectValue(resolve(['billing:finance', text], billing, finance))[1]).toEqual(
        expected,
      );
    }
  });

  it('names the namespace of a namespace.Model reading, and never offers the ambiguous text as the way out', () => {
    const both = (member: string) =>
      contractOf({
        Status: { models: { [member]: {} } },
        public: { enums: { Status: [member] } },
      });
    const failure = expectFailure(
      resolve(['Status.ARCHIVED:Status.RETIRED'], both('ARCHIVED'), both('RETIRED')),
      UNRESOLVED,
    );
    expect({ why: failure.why, fix: failure.fix }).toEqual({
      why: '"Status.ARCHIVED" resolves both as namespace "Status" model "ARCHIVED" and as enum "Status" value "ARCHIVED".',
      fix: 'Write public.Status.ARCHIVED for the enum value. The model cannot be named apart from it: rename namespace "Status" or enum "Status" so that only one reading resolves.',
    });
  });

  it('lists the enum reading beside the field reading when a three-name statement resolves neither', () => {
    const publicOnly = (member: string) =>
      contractOf({
        public: { enums: { Status: [member] } },
        billing: { models: { Invoice: {} } },
      });
    expect(
      expectFailure(
        resolve(
          ['billing.Status.ARCHIVED:billing.Status.RETIRED'],
          publicOnly('ARCHIVED'),
          publicOnly('RETIRED'),
        ),
        UNRESOLVED,
      ).why,
    ).toContain(
      'nor as namespace.Enum.value (the origin contract has no enum "Status" in namespace "billing")',
    );
  });

  it('says "enum value" when a value is renamed twice', () => {
    expect(
      expectFailure(
        resolve(
          ['Status.ARCHIVED:Status.RETIRED', 'Status.ARCHIVED:Status.RETIRED'],
          origin,
          destination,
        ),
        INVALID,
      ).fix,
    ).toBe(
      'Give each model, field or enum value at most one statement, and each new name to one model, field or enum value only.',
    );
  });
});

describe('resolveStatements, enum value statements typed wrong', () => {
  it('lists the enums when the enum is missing, and names one that differs only in case', () => {
    const unknown = expectFailure(
      resolve(['Prio.OLD:Prio.RETIRED'], origin, destination),
      UNRESOLVED,
    );
    const wrongCase = expectFailure(
      resolve(['status.ARCHIVED:status.RETIRED'], origin, destination),
      UNRESOLVED,
    );

    expect({ unknown: unknown.why, wrongCase: wrongCase.fix }).toEqual({
      unknown:
        '"Prio.OLD" resolves neither as namespace.Model (the origin contract has no namespace "Prio" (namespaces: app)), as Model.field (the destination contract has no model "Prio" (models: app.Task)), nor as Enum.value (the origin contract has no enum "Prio" (enums: Priority, Status)).',
      wrongCase: 'Names match exactly, including case: write Status, not status.',
    });
  });

  it('reads a side whose first name is an enum only as a value of that enum', () => {
    expect(
      expectFailure(resolve(['Status.NOPE:Status.RETIRED'], origin, destination), UNRESOLVED).why,
    ).toBe('The origin enum "Status" has no value "NOPE" (values: ARCHIVED, OPEN).');
  });

  it('says to write the new name with its enum when only the old side names an enum value', () => {
    expect(
      expectFailure(resolve(['Status.ARCHIVED:RETIRED'], origin, destination), UNRESOLVED).fix,
    ).toBe('Write the new name with its enum: --rename Status.ARCHIVED:Status.RETIRED.');
  });

  it('refuses a delete of the value a rename of the same run renames', () => {
    expect(
      renamedAndDeleted([
        { verb: 'rename', text: 'Status.ARCHIVED:Status.RETIRED' },
        { verb: 'delete', text: 'Status.ARCHIVED' },
      ]),
    ).toMatchObject({
      code: 'MIGRATION.STATEMENT_INVALID',
      fix: 'Leave out --delete Status.ARCHIVED to keep the data under its new name, or leave out --rename Status.ARCHIVED:Status.RETIRED to delete it.',
    });
  });

  it('says, for enum values that swap names, that a swap of stored values under kept names needs no statement', () => {
    const swapped = contractOf({
      app: { models: { Task: { fields: ['status'] } }, enums: { Status: ['OPEN', 'ARCHIVED'] } },
    });
    expect(
      expectFailure(resolve(['Status.OPEN:Status.ARCHIVED'], swapped, swapped), INVALID).fix,
    ).toContain(
      'If the members keep their names and only their stored values trade places, leave out the statement: the plan asks about each value and names the edits that keep its data.',
    );
  });
});
