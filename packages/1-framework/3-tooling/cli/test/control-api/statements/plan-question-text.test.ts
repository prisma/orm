import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { questionText, refusalText } from '../../../src/control-api/statements/plan-question-text';
import { askedAbout, NO_FLAGS, textsOf } from './plan-question-fixtures';
import { contractOf } from './statement-fixtures';

const app = asNamespaceId('app');

describe('the texts of a removed model', () => {
  it('lists every operation the plan would run', async () => {
    const asked = await askedAbout({
      origin: contractOf({ app: { models: { Legacy: {}, User: {} } } }),
      destination: contractOf({ app: { models: { User: {} } } }),
      losses: [
        {
          label: 'Drop table "legacy"',
          subject: { kind: 'model', namespaceId: app, model: 'Legacy' },
        },
        {
          label: 'Drop table "legacy_audit"',
          subject: { kind: 'model', namespaceId: app, model: 'Legacy' },
        },
      ],
    });

    expect(textsOf(asked)).toMatchInlineSnapshot(`
      {
        "prompts": [
          "Removing model "Legacy" would delete its data.
      The operations of the plan that do this:
      - Drop table "legacy"
      - Drop table "legacy_audit"
      rename works once you add the model to the contract under its new name and run \`{bin} contract emit\`; delete lets its data go.",
        ],
        "refusal": {
          "nextActions": [
            "If the model was renamed, add it to the contract under its new name and run \`{bin} contract emit\`; then keep its data: --rename 'Legacy:<new name>'",
            "If its data can go: --delete Legacy",
          ],
          "summary": "Removing model "Legacy" would delete its data.",
          "why": "The operations of the plan that do this:
      - Drop table "legacy"
      - Drop table "legacy_audit"",
        },
      }
    `);
  });
});

describe('the texts of a removed field whose new name the destination gives', () => {
  it('names the new name in the rename', async () => {
    const asked = await askedAbout({
      origin: contractOf({ app: { models: { Shop: { fields: ['id', 'legacy'] } } } }),
      destination: contractOf({ app: { models: { Shop: { fields: ['id', 'rating'] } } } }),
      losses: [
        {
          label: 'Drop column "legacy" from "Store Front"',
          subject: { kind: 'field', namespaceId: app, model: 'Shop', field: 'legacy' },
        },
      ],
    });

    expect(textsOf(asked)).toMatchInlineSnapshot(`
      {
        "prompts": [
          "Removing field "Shop.legacy" would delete its values.
      The operation of the plan that does this: Drop column "legacy" from "Store Front".
      rename keeps the values under the new name; delete lets them go.",
        ],
        "refusal": {
          "nextActions": [
            "If the field was renamed to "rating", keep its values: --rename Shop.legacy:Shop.rating",
            "If the values can go: --delete Shop.legacy",
          ],
          "summary": "Removing field "Shop.legacy" would delete its values.",
          "why": "The operation of the plan that does this: Drop column "legacy" from "Store Front".",
        },
      }
    `);
  });
});

describe('the texts of a removed enum value', () => {
  it('says it is removed from the data that holds it', async () => {
    const asked = await askedAbout({
      origin: contractOf({
        app: { models: { Task: { fields: ['status'] } }, enums: { Status: ['OPEN', 'ARCHIVED'] } },
      }),
      destination: contractOf({
        app: { models: { Task: { fields: ['status'] } }, enums: { Status: ['OPEN'] } },
      }),
      losses: [
        {
          label: 'Remove value "archived" from "Task"."status"',
          subject: { kind: 'enumValue', namespaceId: app, enum: 'Status', member: 'ARCHIVED' },
        },
      ],
    });

    expect(textsOf(asked)).toMatchInlineSnapshot(`
      {
        "prompts": [
          "Removing enum value "Status.ARCHIVED" would remove it from the data that holds it.
      The operation of the plan that does this: Remove value "archived" from "Task"."status".
      rename works once you add the enum value to the contract under its new name and run \`{bin} contract emit\`; delete removes it from the data.",
        ],
        "refusal": {
          "nextActions": [
            "If the enum value was renamed, add it to the contract under its new name and run \`{bin} contract emit\`; then keep it in the data: --rename 'Status.ARCHIVED:Status.<new name>'",
            "If it can go from the data: --delete Status.ARCHIVED",
          ],
          "summary": "Removing enum value "Status.ARCHIVED" would remove it from the data that holds it.",
          "why": "The operation of the plan that does this: Remove value "archived" from "Task"."status".",
        },
      }
    `);
  });
});

describe('the texts of a removed value object field', () => {
  it('names it through its value object', async () => {
    const place = {
      fields: ['id', 'location'],
      fieldTypes: { location: { valueObject: 'GeoPoint' } },
    };
    const asked = await askedAbout({
      origin: contractOf({
        app: { models: { Place: place }, valueObjects: { GeoPoint: ['lat', 'lng', 'note?'] } },
      }),
      destination: contractOf({
        app: { models: { Place: place }, valueObjects: { GeoPoint: ['lat', 'lng'] } },
      }),
      losses: [
        {
          label: 'Remove key "note" from "place"."location"',
          subject: {
            kind: 'valueObjectField',
            namespaceId: app,
            valueObject: 'GeoPoint',
            field: 'note',
          },
        },
      ],
    });

    expect(textsOf(asked)).toMatchInlineSnapshot(`
      {
        "prompts": [
          "Removing value object field "GeoPoint.note" would delete its values.
      The operation of the plan that does this: Remove key "note" from "place"."location".
      rename works once you add the value object field to the contract under its new name and run \`{bin} contract emit\`; delete lets them go.",
        ],
        "refusal": {
          "nextActions": [
            "If the value object field was renamed, add it to the contract under its new name and run \`{bin} contract emit\`; then keep its values: --rename 'GeoPoint.note:GeoPoint.<new name>'",
            "If the values can go: --delete GeoPoint.note",
          ],
          "summary": "Removing value object field "GeoPoint.note" would delete its values.",
          "why": "The operation of the plan that does this: Remove key "note" from "place"."location".",
        },
      }
    `);
  });
});

describe('the texts of a model of a removed namespace', () => {
  it('offers to delete or rename the whole namespace', async () => {
    const billing = asNamespaceId('billing');
    const asked = await askedAbout({
      origin: contractOf({
        app: { models: { User: {} } },
        billing: { models: { Invoice: {}, Receipt: {} } },
      }),
      destination: contractOf({
        app: { models: { User: {} } },
        finance: { models: { Invoice: {}, Receipt: {} } },
      }),
      losses: [
        {
          label: 'Drop table "invoice"',
          subject: { kind: 'model', namespaceId: billing, model: 'Invoice' },
        },
        {
          label: 'Drop table "receipt"',
          subject: { kind: 'model', namespaceId: billing, model: 'Receipt' },
        },
      ],
      namespaces: { removed: ['billing'], added: ['finance'] },
    });

    expect(textsOf(asked)).toMatchInlineSnapshot(`
      {
        "prompts": [
          "This change would delete the data of model "billing.Invoice".
      The contract no longer has namespace "billing".
      The operation of the plan that does this: Drop table "invoice".
      delete billing lets the data of every model and field of namespace "billing" go; rename billing:finance keeps the data of namespace "billing" under namespace "finance"; rename keeps its data under the new name, "finance.Invoice" or "finance.Receipt"; delete lets its data go.",
          "This change would delete the data of model "billing.Receipt".
      The operation of the plan that does this: Drop table "receipt".
      rename keeps its data under the new name, "finance.Invoice" or "finance.Receipt"; delete lets its data go.",
        ],
        "refusal": {
          "nextActions": [
            "If the data of everything in namespace "billing" can go: --delete billing",
            "If namespace "billing" was renamed to "finance", keep its data: --rename billing:finance",
            "If model "billing.Invoice" was renamed to "finance.Invoice" or "finance.Receipt", put that name in place of <new name> to keep its data: --rename 'billing.Invoice:<new name>'",
            "If the data of model "billing.Invoice" can go: --delete billing.Invoice",
            "If model "billing.Receipt" was renamed to "finance.Invoice" or "finance.Receipt", put that name in place of <new name> to keep its data: --rename 'billing.Receipt:<new name>'",
            "If the data of model "billing.Receipt" can go: --delete billing.Receipt",
          ],
          "summary": "This change would lose data: model "billing.Invoice", model "billing.Receipt".",
          "why": "This change would delete the data of model "billing.Invoice".
      The contract no longer has namespace "billing".
      The operation of the plan that does this: Drop table "invoice".

      This change would delete the data of model "billing.Receipt".
      The operation of the plan that does this: Drop table "receipt".",
        },
      }
    `);
  });
});

describe('the texts of storage no model stores', () => {
  const users = contractOf({ app: { models: { User: { fields: ['email'] } } } });
  const loss = {
    label: 'Drop column "age" from "user"',
    subject: { kind: 'storage', name: 'public.user.age' },
  } as const;

  it('says no model of the contract before this change stores it', async () => {
    const asked = await askedAbout({ origin: users, destination: users, losses: [loss] });

    expect(textsOf(asked)).toMatchInlineSnapshot(`
      {
        "prompts": [
          "This change would delete the data in "public.user.age", which no model of the contract before this change stores.
      The operation of the plan that does this: Drop column "age" from "user".
      delete lets the data go.",
        ],
        "refusal": {
          "nextActions": [
            "If the data can go: --delete public.user.age",
          ],
          "summary": "This change would delete the data in "public.user.age", which no model of the contract before this change stores.",
          "why": "The operation of the plan that does this: Drop column "age" from "user".",
        },
      }
    `);
  });

  it('says it is named by its storage name, and how to keep it, when the contract before this change is not known', async () => {
    const asked = await askedAbout({
      origin: users,
      destination: users,
      losses: [loss],
      originKnown: false,
    });

    expect(textsOf(asked)).toMatchInlineSnapshot(`
      {
        "prompts": [
          "This change would delete the data in "public.user.age", named by its storage name because the contract before this change is not known.
      The operation of the plan that does this: Drop column "age" from "user".
      If it was renamed, keep its data: store a snapshot of the contract before this change, which is the contract the database was last updated to, then run this command again, and it gives the --rename to use.
      1. Put the contract source back to the version the database is at, and run \`{bin} contract emit\`.
      2. Run \`{bin} db update --advance-ref <name> --dry-run\`, with the same \`--db\` as this command if it has one, and check that it plans no operations. Then run it again without \`--dry-run\`: the database matches that contract, so this changes nothing in it, and it stores the contract snapshot. If the dry run plans operations, the database has drifted from that contract; settle that before you go on.
      3. Put the new contract source back, run \`{bin} contract emit\`, and run this command again with \`--advance-ref <name>\`.
      delete lets the data go.",
        ],
        "refusal": {
          "nextActions": [
            "If it was renamed, keep its data: store a snapshot of the contract before this change, which is the contract the database was last updated to, then run this command again, and it gives the --rename to use.",
            "1. Put the contract source back to the version the database is at, and run \`{bin} contract emit\`.",
            "2. Run \`{bin} db update --advance-ref <name> --dry-run\`, with the same \`--db\` as this command if it has one, and check that it plans no operations. Then run it again without \`--dry-run\`: the database matches that contract, so this changes nothing in it, and it stores the contract snapshot. If the dry run plans operations, the database has drifted from that contract; settle that before you go on.",
            "3. Put the new contract source back, run \`{bin} contract emit\`, and run this command again with \`--advance-ref <name>\`.",
            "If the data can go: --delete public.user.age",
          ],
          "summary": "This change would delete the data in "public.user.age", named by its storage name because the contract before this change is not known.",
          "why": "The operation of the plan that does this: Drop column "age" from "user".",
        },
      }
    `);
  });
});

describe('the texts of a type change', () => {
  const origin = contractOf({ app: { models: { User: { fields: ['age'] } } } });
  const destination = contractOf({
    app: { models: { User: { fields: ['age'], fieldTypes: { age: { codecId: 'test/int@1' } } } } },
  });
  const losses = [
    {
      label: 'Alter type of "user"."age" to int4',
      subject: { kind: 'field', namespaceId: app, model: 'User', field: 'age' },
      loss: 'typeChange',
    },
  ] as const;

  it('offers to convert or cast where the command writes a migration', async () => {
    const asked = await askedAbout({ origin, destination, losses });

    expect(textsOf(asked)).toMatchInlineSnapshot(`
      {
        "prompts": [
          "Changing the type of field "User.age" can change or lose its values.
      The operation of the plan that does this: Alter type of "user"."age" to int4.
      convert writes a conversion for you to fill in; delete lets the database cast the values, which can change or lose some.",
        ],
        "refusal": {
          "nextActions": [
            "To write the conversion yourself: --convert User.age",
            "To let the database cast the values, which can change or lose some: --delete User.age",
          ],
          "summary": "Changing the type of field "User.age" can change or lose its values.",
          "why": "The operation of the plan that does this: Alter type of "user"."age" to int4.",
        },
      }
    `);
  });

  it('offers only to cast where the command writes no migration', async () => {
    const asked = await askedAbout({ origin, destination, losses, canConvert: false });

    expect(textsOf(asked)).toMatchInlineSnapshot(`
      {
        "prompts": [
          "Changing the type of field "User.age" can change or lose its values.
      The operation of the plan that does this: Alter type of "user"."age" to int4.
      delete lets the database cast the values, which can change or lose some.",
        ],
        "refusal": {
          "nextActions": [
            "To let the database cast the values, which can change or lose some: --delete User.age",
          ],
          "summary": "Changing the type of field "User.age" can change or lose its values.",
          "why": "The operation of the plan that does this: Alter type of "user"."age" to int4.",
        },
      }
    `);
  });
});

describe('the texts of an access change', () => {
  it('asks once about every access change of a model, and says access would change', async () => {
    const users = contractOf({ app: { models: { User: {} } } });
    const user = { kind: 'model', namespaceId: app, model: 'User' } as const;
    const asked = await askedAbout({
      origin: users,
      destination: users,
      accessChanges: [
        { label: 'Disable row-level security on "user"', subject: user, widens: true },
        { label: 'Drop policy "readers" on "user"', subject: user, widens: false },
      ],
    });

    expect({
      prompts: asked.map((each) => questionText(each)),
      refusals: asked.map((question) => refusalText([question], NO_FLAGS)),
    }).toMatchInlineSnapshot(`
      {
        "prompts": [
          "Access to the data of "User" would widen.
      The operations of the plan that do this:
      - Disable row-level security on "user"
      - Drop policy "readers" on "user"
      allow lets the plan make these changes.",
        ],
        "refusals": [
          {
            "nextActions": [
              "To allow both changes: --allow User",
            ],
            "summary": "Access to the data of "User" would widen.",
            "why": "The operations of the plan that do this:
      - Disable row-level security on "user"
      - Drop policy "readers" on "user"",
          },
        ],
      }
    `);
  });
});

describe('the texts of a variant whose discriminator value changed', () => {
  it('names the old and new discriminator values, and offers to convert its stored value', async () => {
    const task = (variants: Record<string, string>) =>
      contractOf({
        app: {
          models: {
            Task: { fields: ['type'], discriminator: 'type', variants },
            Bug: { base: 'Task' },
          },
        },
      });
    const asked = await askedAbout({
      origin: task({ bug: 'Bug' }),
      destination: task({ defect: 'Bug' }),
      losses: [
        {
          label: 'Rewrite "type" of "task" from "bug"',
          subject: { kind: 'model', namespaceId: app, model: 'Bug' },
        },
      ],
    });

    expect(textsOf(asked)).toMatchInlineSnapshot(`
      {
        "prompts": [
          "Changing the discriminator value of model "Bug" from "bug" to "defect" would delete its data.
      The operation of the plan that does this: Rewrite "type" of "task" from "bug".
      convert rewrites the discriminator value from "bug" to "defect" and keeps the data; delete lets its data go.",
        ],
        "refusal": {
          "nextActions": [
            "To rewrite its discriminator value from "bug" to "defect" and keep its data: --convert Bug",
            "If its data can go: --delete Bug",
          ],
          "summary": "Changing the discriminator value of model "Bug" from "bug" to "defect" would delete its data.",
          "why": "The operation of the plan that does this: Rewrite "type" of "task" from "bug".",
        },
      }
    `);
  });
});
