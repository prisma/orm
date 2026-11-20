import { asNamespaceId, type ContractWithDomain } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { migrationPlanKeepDataEditAdvice } from '../../../src/utils/keep-data-edit-advice';
import { askedAbout, textsOf } from './plan-question-fixtures';
import { contractOf } from './statement-fixtures';

const app = asNamespaceId('app');
const PROJECT = { cwd: '/work/app', configPath: undefined, dbGiven: false };

describe('the rename of a removed field when the contract adds several fields', () => {
  it('lists the new names and says where to put the chosen one', async () => {
    const asked = await askedAbout({
      origin: contractOf({ app: { models: { Shop: { fields: ['id', 'legacy'] } } } }),
      destination: contractOf({
        app: { models: { Shop: { fields: ['id', 'rating', 'score'] } } },
      }),
      losses: [
        {
          label: 'Drop column "legacy" from "shop"',
          subject: { kind: 'field', namespaceId: app, model: 'Shop', field: 'legacy' },
        },
      ],
    });

    expect(textsOf(asked)).toMatchInlineSnapshot(`
      {
        "prompts": [
          "Removing field "Shop.legacy" would delete its values.
      The operation of the plan that does this: Drop column "legacy" from "shop".
      rename keeps the values under the new name; delete lets them go.",
        ],
        "refusal": {
          "nextActions": [
            "If the field was renamed to "rating" or "score", put that name in place of <new name> to keep its values: --rename 'Shop.legacy:Shop.<new name>'",
            "If the values can go: --delete Shop.legacy",
          ],
          "summary": "Removing field "Shop.legacy" would delete its values.",
          "why": "The operation of the plan that does this: Drop column "legacy" from "shop".",
        },
      }
    `);
  });
});

describe('the rename of a removed model when the contract adds one model', () => {
  it('names the new model in the rename', async () => {
    const asked = await askedAbout({
      origin: contractOf({ app: { models: { Bug: {}, Shop: {} } } }),
      destination: contractOf({ app: { models: { Issue: {}, Shop: {} } } }),
      losses: [
        { label: 'Drop table "bug"', subject: { kind: 'model', namespaceId: app, model: 'Bug' } },
      ],
    });

    expect(textsOf(asked)).toMatchInlineSnapshot(`
      {
        "prompts": [
          "Removing model "Bug" would delete its data.
      The operation of the plan that does this: Drop table "bug".
      rename keeps its data under the new name; delete lets its data go.",
        ],
        "refusal": {
          "nextActions": [
            "If the model was renamed to "Issue", keep its data: --rename Bug:Issue",
            "If its data can go: --delete Bug",
          ],
          "summary": "Removing model "Bug" would delete its data.",
          "why": "The operation of the plan that does this: Drop table "bug".",
        },
      }
    `);
  });
});

function withStoredValues(members: Readonly<Record<string, string>>): ContractWithDomain {
  const contract = contractOf({
    app: { models: { Task: { fields: ['status'] } }, enums: { Status: Object.keys(members) } },
  });
  const namespace = contract.domain.namespaces[app];
  const status = namespace?.enum?.['Status'];
  if (namespace === undefined || status === undefined) throw new Error('Expected enum Status');
  return {
    ...contract,
    domain: {
      ...contract.domain,
      namespaces: {
        [app]: {
          ...namespace,
          enum: {
            Status: {
              ...status,
              members: Object.entries(members).map(([name, value]) => ({ name, value })),
            },
          },
        },
      },
    },
  };
}

describe('the texts of an enum value whose member keeps its name with a new stored value', () => {
  it('names the old and new stored values, and says --delete keeps the data with the edits migration plan gives', async () => {
    const asked = await askedAbout({
      origin: withStoredValues({ ACTIVE: 'active', ARCHIVED: 'archived' }),
      destination: withStoredValues({ ACTIVE: 'on', ARCHIVED: 'archived' }),
      keepDataEditAdvice: migrationPlanKeepDataEditAdvice(PROJECT),
      losses: [
        {
          label: 'Remove value "active" from "task"."status"',
          subject: { kind: 'enumValue', namespaceId: app, enum: 'Status', member: 'ACTIVE' },
          keepDataEdit: {
            remove: 'this.removeStoredValue()',
            replaceWith: 'this.replaceStoredValue()',
          },
        },
      ],
    });

    expect(textsOf(asked)).toMatchInlineSnapshot(`
      {
        "prompts": [
          "Changing the stored value of enum value "Status.ACTIVE" from "active" to "on" would remove "active" from the data that holds it.
      The operation of the plan that does this: Remove value "active" from "task"."status".
      To keep that data, run this command with --delete Status.ACTIVE, then in the migration.ts it writes replace this.removeStoredValue() with this.replaceStoredValue(), run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with \`{bin} db migrate\`.
      delete removes it from the data.",
        ],
        "refusal": {
          "nextActions": [
            "To keep that data, run this command with --delete Status.ACTIVE, then in the migration.ts it writes replace this.removeStoredValue() with this.replaceStoredValue(), run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with \`{bin} db migrate\`.",
            "If it can go from the data, or to keep the data by editing migration.ts as above: --delete Status.ACTIVE",
          ],
          "summary": "Changing the stored value of enum value "Status.ACTIVE" from "active" to "on" would remove "active" from the data that holds it.",
          "why": "The operation of the plan that does this: Remove value "active" from "task"."status".",
        },
      }
    `);
  });
});
