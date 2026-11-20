import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { resolveStatements } from '../../../src/control-api/statements/resolve-statements';
import { askedAbout } from './plan-question-fixtures';
import { contractOf, expectValue, failureShape } from './statement-fixtures';

const app = asNamespaceId('app');

const origin = contractOf({
  app: {
    models: { Shop: { fields: ['id', 'legacy'] } },
    enums: { Status: ['OPEN', 'ARCHIVED'] },
    valueObjects: { GeoPoint: ['lat', 'note?'] },
  },
});
const destination = contractOf({
  app: {
    models: { Shop: { fields: ['id', 'rating', 'score'] } },
    enums: { Status: ['OPEN', 'RETIRED'] },
    valueObjects: { GeoPoint: ['lat'] },
  },
});

function renamed(text: string) {
  return failureShape(
    resolveStatements({
      statements: [{ verb: 'rename', text }],
      origin: { kind: 'contract', contract: origin },
      destination,
    }),
  );
}

describe('a --rename to a name the contract does not have', () => {
  it('says so for an enum value, naming the values the contract adds', () => {
    expect(renamed('Status.ARCHIVED:Status.GONE')).toEqual({
      code: 'MIGRATION.STATEMENT_UNRESOLVED',
      summary: 'The contract has no enum value "Status.GONE" to rename "Status.ARCHIVED" to.',
      why: 'The contract adds enum value "Status.RETIRED".',
      nextActions: [
        'If enum value "Status.ARCHIVED" was renamed to "Status.GONE", add enum value "Status.GONE" to the contract, run `{bin} contract emit`, and run this command again.',
        'If enum value "Status.ARCHIVED" was renamed to "Status.RETIRED", put this in place of --rename Status.ARCHIVED:Status.GONE: --rename Status.ARCHIVED:Status.RETIRED',
      ],
      meta: { statement: 'Status.ARCHIVED:Status.GONE', verb: 'rename' },
    });
  });

  it('says so for a value object field the contract adds nothing beside', () => {
    expect(renamed('GeoPoint.note:GeoPoint.memo')).toEqual({
      code: 'MIGRATION.STATEMENT_UNRESOLVED',
      summary:
        'The contract has no value object field "GeoPoint.memo" to rename "GeoPoint.note" to.',
      nextActions: [
        'If value object field "GeoPoint.note" was renamed to "GeoPoint.memo", add value object field "GeoPoint.memo" to the contract, run `{bin} contract emit`, and run this command again.',
      ],
      meta: { statement: 'GeoPoint.note:GeoPoint.memo', verb: 'rename' },
    });
  });

  it('keeps the resolver error for a field the contract still has', () => {
    const shape = renamed('Shop.id:Shop.ident') as { readonly summary: string };

    expect(shape.summary).toBe('Cannot resolve statement "--rename Shop.id:Shop.ident"');
  });
});

describe('a rename typed at the prompt whose new name does not fit', () => {
  it('says the contract has no such field, the fields it adds, and how to add it; or that it had the field before', async () => {
    const [question] = await askedAbout({
      origin,
      destination,
      losses: [
        {
          label: 'Drop column "legacy" from "shop"',
          subject: { kind: 'field', namespaceId: app, model: 'Shop', field: 'legacy' },
        },
      ],
    });

    expect({
      missing: question?.validate('rename', 'Shop.legacy:Shop.nope'),
      hadBefore: question?.validate('rename', 'Shop.legacy:Shop.id'),
      otherOldName: question?.validate('rename', 'Shop.legacyx:Shop.rating'),
      fits: question?.validate('rename', 'Shop.legacy:Shop.rating'),
    }).toEqual({
      missing:
        'the contract has no field "Shop.nope" to rename "Shop.legacy" to. The contract adds fields "Shop.rating" and "Shop.score". If field "Shop.legacy" was renamed to "Shop.nope", stop this command, add field "Shop.nope" to the contract, run `{bin} contract emit`, and run this command again.',
      hadBefore:
        'the contract had field "Shop.id" before this change too, so one change cannot make it the new name of "Shop.legacy".',
      otherOldName:
        'The rename\'s old name is not "Shop.legacy". Write it as Shop.legacy:Shop.<new name>.',
      fits: undefined,
    });
  });
});

describe('the new names a removed model can have', () => {
  const issues = (variants: Readonly<Record<string, string>>, extra: Record<string, object>) =>
    contractOf({
      app: {
        models: {
          Issue: { fields: ['id', 'kind'], discriminator: 'kind', variants },
          ...Object.fromEntries(
            Object.values(variants).map((model) => [model, { fields: ['id'], base: 'Issue' }]),
          ),
          ...extra,
        },
      },
    });
  const variantOrigin = issues({ bug: 'Bug', task: 'Task' }, {});
  const variantDestination = issues(
    { defect: 'Defect', task: 'Task' },
    { Audit: { fields: ['id'] } },
  );
  const bugRemoved = {
    label: 'Delete the rows of variant "Bug"',
    subject: { kind: 'model', namespaceId: app, model: 'Bug' },
  } as const;

  it('are the same in the refusal and in the error for a --rename to a missing name, and the printed --rename resolves', async () => {
    const [question] = await askedAbout({
      origin: variantOrigin,
      destination: variantDestination,
      losses: [bugRemoved],
    });
    const resolve = (text: string) =>
      resolveStatements({
        statements: [{ verb: 'rename', text }],
        origin: { kind: 'contract', contract: variantOrigin },
        destination: variantDestination,
      });
    const flagError = failureShape(resolve('Bug:Nope')) as { readonly nextActions: string[] };
    const printed = flagError.nextActions.at(-1)?.split(': ')[1]?.replace('--rename ', '') ?? '';

    expect({
      refusal: question?.answers.map(({ meaning, flag }) => `${meaning}: ${flag.text}`),
      flagError,
      followed: expectValue(resolve(printed)),
    }).toEqual({
      refusal: [
        'If the model was renamed to "Defect", keep its data: Bug:Defect',
        'If its data can go: Bug',
      ],
      flagError: {
        code: 'MIGRATION.STATEMENT_UNRESOLVED',
        summary: 'The contract has no model "Nope" to rename "Bug" to.',
        why: 'The contract adds model "Defect".',
        nextActions: [
          'If model "Bug" was renamed to "Nope", add model "Nope" to the contract, run `{bin} contract emit`, and run this command again.',
          'If model "Bug" was renamed to "Defect", put this in place of --rename Bug:Nope: --rename Bug:Defect',
        ],
        meta: { statement: 'Bug:Nope', verb: 'rename' },
      },
      followed: [
        {
          kind: 'rename',
          entity: 'model',
          from: { namespaceId: app, model: 'Bug' },
          to: { namespaceId: app, model: 'Defect' },
        },
      ],
    });
  });

  it('leave out a model that only moved with a renamed namespace, in the refusal and in the error alike', async () => {
    const origin = contractOf({
      app: { models: { Bug: { fields: ['id'] } } },
      billing: { models: { Invoice: { fields: ['id'] } } },
    });
    const destination = contractOf({
      app: { models: { Defect: { fields: ['id'] } } },
      finance: { models: { Invoice: { fields: ['id'] } } },
    });
    const [question] = await askedAbout({
      origin,
      destination,
      statements: [{ verb: 'rename', text: 'billing:finance' }],
      losses: [{ ...bugRemoved, label: 'Drop table "bug"' }],
    });
    const flagError = failureShape(
      resolveStatements({
        statements: [
          { verb: 'rename', text: 'billing:finance' },
          { verb: 'rename', text: 'app.Bug:app.Nope' },
        ],
        origin: { kind: 'contract', contract: origin },
        destination,
      }),
    );

    expect({
      refusal: question?.answers.map(({ meaning }) => meaning),
      flagError,
    }).toEqual({
      refusal: ['If the model was renamed to "app.Defect", keep its data', 'If its data can go'],
      flagError: {
        code: 'MIGRATION.STATEMENT_UNRESOLVED',
        summary: 'The contract has no model "app.Nope" to rename "app.Bug" to.',
        why: 'The contract adds model "app.Defect".',
        nextActions: [
          'If model "app.Bug" was renamed to "app.Nope", add model "app.Nope" to the contract, run `{bin} contract emit`, and run this command again.',
          'If model "app.Bug" was renamed to "app.Defect", put this in place of --rename app.Bug:app.Nope: --rename app.Bug:app.Defect',
        ],
        meta: { statement: 'app.Bug:app.Nope', verb: 'rename' },
      },
    });
  });
});
