import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { questionText } from '../../../src/control-api/statements/plan-question-text';
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

/** The rename a line says to use in place of the one given, as `--rename` takes it. */
function usedInPlace(line: string | undefined): string {
  return /use --rename (\S+) in place of/.exec(line ?? '')?.[1] ?? '';
}

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
        'If enum value "Status.ARCHIVED" was renamed to "Status.RETIRED", use --rename Status.ARCHIVED:Status.RETIRED in place of --rename Status.ARCHIVED:Status.GONE',
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
        'the contract had field "Shop.id" before this change too, so one change cannot make it the new name of "Shop.legacy". The contract adds fields "Shop.rating" and "Shop.score". If "Shop.legacy" is to take the name "Shop.id" from the field that has it now, stop this command and do it in two steps. First, in the contract, give field "Shop.id" its new name or remove it, and keep "Shop.legacy" as it was; run `{bin} contract emit`, and run this command again. Then rename "Shop.legacy" to "Shop.id" in the contract, run `{bin} contract emit`, and run this command again with --rename Shop.legacy:Shop.id.',
      otherOldName: 'To rename "Shop.legacy", type rename Shop.legacy:Shop.<new name>.',
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
    const printed = usedInPlace(flagError.nextActions.at(-1));

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
          'If model "Bug" was renamed to "Nope", add model "Nope" to the contract as a variant of model "Issue", run `{bin} contract emit`, and run this command again.',
          'If model "Bug" was renamed to "Defect", use --rename Bug:Defect in place of --rename Bug:Nope',
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

  it('say a variant gets its new name as a variant of the same base when the contract adds none, and the --rename resolves once it does', async () => {
    const withoutVariant = issues({ task: 'Task' }, { Audit: { fields: ['id'] } });
    const [question] = await askedAbout({
      origin: variantOrigin,
      destination: withoutVariant,
      losses: [bugRemoved],
    });
    const resolve = (destination: typeof withoutVariant, text: string) =>
      resolveStatements({
        statements: [{ verb: 'rename', text }],
        origin: { kind: 'contract', contract: variantOrigin },
        destination,
      });

    expect({
      refusal: question?.answers.map(({ meaning, flag }) => `${meaning}: ${flag.text}`),
      prompt: question?.answers.map(({ promptMeaning }) => promptMeaning),
      flagError: failureShape(resolve(withoutVariant, 'Bug:Nope')),
      followed: expectValue(resolve(variantDestination, 'Bug:Defect')),
    }).toEqual({
      refusal: [
        'If the model was renamed, add it to the contract under its new name as a variant of model "Issue" and run `{bin} contract emit`; then keep its data: Bug:<new name>',
        'If its data can go: Bug',
      ],
      prompt: [
        'rename works only once the contract has the model under its new name as a variant of model "Issue": stop this command, add it to the contract, run `{bin} contract emit`, and run this command again',
        'delete lets its data go',
      ],
      flagError: {
        code: 'MIGRATION.STATEMENT_UNRESOLVED',
        summary: 'The contract has no model "Nope" to rename "Bug" to.',
        nextActions: [
          'If model "Bug" was renamed to "Nope", add model "Nope" to the contract as a variant of model "Issue", run `{bin} contract emit`, and run this command again.',
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

  it('leave out a name a later --rename gives, whatever the order of the flags', () => {
    const origin = contractOf({
      app: { models: { Bug: { fields: ['id'] }, Task: { fields: ['id'] } } },
      billing: { models: { Invoice: { fields: ['id'] } } },
    });
    const destination = contractOf({
      app: { models: { Ticket: { fields: ['id'] } } },
      finance: { models: { Invoice: { fields: ['id'] } } },
    });
    const refused = (...texts: readonly string[]) =>
      (
        failureShape(
          resolveStatements({
            statements: texts.map((text) => ({ verb: 'rename' as const, text })),
            origin: { kind: 'contract', contract: origin },
            destination,
          }),
        ) as { readonly nextActions: readonly string[] }
      ).nextActions;

    expect({
      modelLater: refused('app.Bug:app.Nope', 'app.Task:app.Ticket'),
      namespaceLater: refused('app.Bug:app.Nope', 'app.Task:app.Ticket', 'billing:finance'),
    }).toEqual({
      modelLater: [
        'If model "app.Bug" was renamed to "app.Nope", add model "app.Nope" to the contract, run `{bin} contract emit`, and run this command again.',
        'If model "app.Bug" was renamed to "finance.Invoice", use --rename app.Bug:finance.Invoice in place of --rename app.Bug:app.Nope',
      ],
      namespaceLater: [
        'If model "app.Bug" was renamed to "app.Nope", add model "app.Nope" to the contract, run `{bin} contract emit`, and run this command again.',
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
          'If model "app.Bug" was renamed to "app.Defect", use --rename app.Bug:app.Defect in place of --rename app.Bug:app.Nope',
        ],
        meta: { statement: 'app.Bug:app.Nope', verb: 'rename' },
      },
    });
  });
});

describe('a removed field when the command plans to a ref', () => {
  it('says at the prompt and in the refusal to add the new name and run again without --to', async () => {
    const [question] = await askedAbout({
      origin,
      destination: contractOf({ app: { models: { Shop: { fields: ['id'] } } } }),
      destinationRef: 'next',
      losses: [
        {
          label: 'Drop column "legacy" from "shop"',
          subject: { kind: 'field', namespaceId: app, model: 'Shop', field: 'legacy' },
        },
      ],
    });

    expect({
      prompt: question === undefined ? undefined : questionText(question),
      refusal: question?.answers.map(({ meaning }) => meaning),
      typed: question?.validate('rename', 'Shop.legacy:Shop.nope'),
    }).toEqual({
      prompt:
        'Removing field "Shop.legacy" would delete its values.\nThe operation of the plan that does this: Drop column "legacy" from "shop".\nrename works only once the contract has the field under its new name: stop this command, add it to the contract, run `prisma contract emit`, and run this command again without --to next, so that it plans to the emitted contract and not to the one that --to next names; delete lets the values go.',
      refusal: [
        'If the field was renamed, add it to the contract under its new name and run `{bin} contract emit`, then run this command again without --to next, so that it plans to the emitted contract and not to the one that --to next names, and keep its values',
        'If the values can go',
      ],
      typed:
        'the contract that --to next names has no field "Shop.nope" to rename "Shop.legacy" to. If field "Shop.legacy" was renamed to "Shop.nope", stop this command, add field "Shop.nope" to the contract, run `{bin} contract emit`, and run this command again without --to next, so that it plans to the emitted contract and not to the one that --to next names.',
    });
  });
});

describe('a --rename to a name the contract had before the change too', () => {
  it('says so as the prompt does, and the --rename it offers in place of the one given resolves', () => {
    const resolve = (text: string) =>
      resolveStatements({
        statements: [{ verb: 'rename', text }],
        origin: { kind: 'contract', contract: origin },
        destination,
      });
    const refused = failureShape(resolve('Shop.legacy:Shop.id')) as {
      readonly nextActions: readonly string[];
    };
    const printed = usedInPlace(refused.nextActions[0]);

    expect({ refused, followed: expectValue(resolve(printed)) }).toEqual({
      refused: {
        code: 'MIGRATION.STATEMENT_UNRESOLVED',
        summary:
          'The contract had field "Shop.id" before this change too, so one change cannot make it the new name of "Shop.legacy".',
        why: 'The contract adds fields "Shop.rating" and "Shop.score".',
        nextActions: [
          'If field "Shop.legacy" was renamed to "Shop.rating", use --rename Shop.legacy:Shop.rating in place of --rename Shop.legacy:Shop.id',
          'If field "Shop.legacy" was renamed to "Shop.score", use --rename Shop.legacy:Shop.score in place of --rename Shop.legacy:Shop.id',
          'If "Shop.legacy" is to take the name "Shop.id" from the field that has it now, do it in two steps. First, in the contract, give field "Shop.id" its new name or remove it, and keep "Shop.legacy" as it was; run `{bin} contract emit`, and run this command again. Then rename "Shop.legacy" to "Shop.id" in the contract, run `{bin} contract emit`, and run this command again with --rename Shop.legacy:Shop.id.',
        ],
        meta: { statement: 'Shop.legacy:Shop.id', verb: 'rename' },
      },
      followed: [
        {
          kind: 'rename',
          entity: 'field',
          from: { namespaceId: app, model: 'Shop', field: 'legacy' },
          to: { namespaceId: app, model: 'Shop', field: 'rating' },
        },
      ],
    });
  });
});
