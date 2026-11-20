import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { refusalText } from '../../../src/control-api/statements/plan-question-text';
import { askedAbout, NO_FLAGS } from './plan-question-fixtures';
import { contractOf } from './statement-fixtures';

const app = asNamespaceId('app');
const billing = asNamespaceId('billing');
const YES = { ...NO_FLAGS, yes: true };

const shop = (fields: readonly string[], ageType?: string) =>
  contractOf({
    app: {
      models: {
        Shop: {
          fields: [...fields],
          ...(ageType === undefined ? {} : { fieldTypes: { age: { codecId: ageType } } }),
        },
        User: {},
      },
    },
  });

const retyped = (field: string) => ({
  label: `Alter "shop"."${field}"`,
  loss: 'typeChange' as const,
  subject: { kind: 'field' as const, namespaceId: app, model: 'Shop', field },
});

describe('the summary and the --yes line of a refusal', () => {
  it('say only that type changes can change or lose data when nothing else is open', async () => {
    const asked = await askedAbout({
      origin: shop(['id', 'age', 'score']),
      destination: shop(['id', 'age', 'score'], 'test/int@1'),
      canConvert: false,
      losses: [retyped('age'), retyped('score')],
    });

    const { summary, why } = refusalText(asked, YES);

    expect({ summary, yes: why?.split('\n').at(-1) }).toEqual({
      summary: 'This change would change or lose data: field "Shop.age", field "Shop.score".',
      yes: '--yes does not allow this: it can change or lose data.',
    });
  });

  it('name every kind of change that is open', async () => {
    const asked = await askedAbout({
      origin: shop(['id', 'age', 'legacy']),
      destination: shop(['id', 'age'], 'test/int@1'),
      canConvert: false,
      losses: [
        retyped('age'),
        {
          label: 'Drop "shop"."legacy"',
          subject: { kind: 'field', namespaceId: app, model: 'Shop', field: 'legacy' },
        },
      ],
      accessChanges: [
        {
          label: 'Drop policy "readers" on "user"',
          subject: { kind: 'model', namespaceId: app, model: 'User' },
          widens: false,
        },
      ],
    });
    const typeAndAccess = asked.filter(({ subject }) => subject !== 'Shop.legacy');

    expect(
      [asked, typeAndAccess].map((open) => {
        const { summary, why } = refusalText(open, YES);
        return { summary, yes: why?.split('\n').at(-1) };
      }),
    ).toEqual([
      {
        summary:
          'This change would lose data and change access: field "Shop.age", field "Shop.legacy", model "User".',
        yes: '--yes does not allow this: it would delete data, can change or lose data and would change who can read and write data.',
      },
      {
        summary:
          'This change would change or lose data and change access: field "Shop.age", model "User".',
        yes: '--yes does not allow this: it can change or lose data and would change who can read and write data.',
      },
    ]);
  });
});

describe('the ways to keep the data when several are open', () => {
  it('name the subject each way is for, and the storage the snapshot steps are for', async () => {
    const asked = await askedAbout({
      origin: shop(['id', 'legacy']),
      destination: shop(['id']),
      originKnown: false,
      losses: [
        {
          label: 'Drop "shop"."legacy"',
          subject: { kind: 'field', namespaceId: app, model: 'Shop', field: 'legacy' },
          keepDataAdvice: 'To keep its data, move the column by hand.',
        },
        { label: 'Drop "audit"', subject: { kind: 'storage', name: 'audit' } },
        { label: 'Drop "audit_old"', subject: { kind: 'storage', name: 'audit_old' } },
      ],
    });

    const { nextActions } = refusalText(asked, NO_FLAGS);

    expect(nextActions.slice(0, 2)).toEqual([
      'For field "Shop.legacy": to keep its data, move the column by hand.',
      'If "audit" or "audit_old" was renamed, keep its data: store a snapshot of the contract before this change, which is the contract the database was last updated to, then run this command again, and it gives the --rename to use.',
    ]);
  });
});

describe('a way to keep the data that several open questions give alike', () => {
  it('is given once, naming every subject it is for', async () => {
    const advice = 'The destination stores both in one table; write the merge by hand.';
    const asked = await askedAbout({
      origin: contractOf({ app: { models: { Bug: {}, Task: {} } } }),
      destination: contractOf({ app: { models: {} } }),
      losses: ['Bug', 'Task'].map((model) => ({
        label: `Drop table "${model.toLowerCase()}"`,
        subject: { kind: 'model' as const, namespaceId: app, model },
        keepDataAdvice: advice,
      })),
    });

    expect(refusalText(asked, NO_FLAGS).nextActions[0]).toBe(
      'For model "Bug" and model "Task": the destination stores both in one table; write the merge by hand.',
    );
  });
});

describe('the fact of a removed namespace', () => {
  const origin = contractOf({
    app: { models: { User: {} } },
    billing: { models: { Invoice: {} } },
  });
  const destination = contractOf({ app: { models: { User: {} } } });
  const invoice = {
    label: 'Drop table "invoice"',
    subject: { kind: 'model' as const, namespaceId: billing, model: 'Invoice' },
  };

  it('stays with the operation line, without a blank line between them', async () => {
    const asked = await askedAbout({
      origin,
      destination,
      losses: [invoice],
      namespaces: { removed: ['billing'], added: [] },
    });

    expect(refusalText(asked, NO_FLAGS).why).toBe(
      'The contract no longer has namespace "billing".\nThe operation of the plan that does this: Drop table "invoice".',
    );
  });

  it('comes after the headline of the first question about the namespace when several are open', async () => {
    const asked = await askedAbout({
      origin,
      destination: contractOf({ app: { models: {} } }),
      losses: [
        { label: 'Drop table "user"', subject: { kind: 'model', namespaceId: app, model: 'User' } },
        invoice,
      ],
      namespaces: { removed: ['billing'], added: [] },
    });

    expect(refusalText(asked, NO_FLAGS).why).toBe(
      [
        'Removing model "app.User" would delete its data.',
        'The operation of the plan that does this: Drop table "user".',
        '',
        'This change would delete the data of model "billing.Invoice".',
        'The contract no longer has namespace "billing".',
        'The operation of the plan that does this: Drop table "invoice".',
      ].join('\n'),
    );
  });
});

describe('a flag with the right subject and a verb its change does not take', () => {
  it('gets a line that says to remove it and why', async () => {
    const asked = await askedAbout({
      origin: shop(['id']),
      destination: contractOf({ app: { models: { Shop: { fields: ['id'] } } } }),
      losses: [
        { label: 'Drop table "user"', subject: { kind: 'model', namespaceId: app, model: 'User' } },
      ],
    });

    const { nextActions } = refusalText(asked, {
      ...NO_FLAGS,
      misdirected: [
        { verb: 'allow', text: 'User', subjectInList: 'model "User"' },
        { verb: 'delete', text: 'Shop', subjectInList: '"Shop"' },
      ],
    });

    expect(nextActions.slice(0, 2)).toEqual([
      'Remove --allow User: this change does not change access to model "User".',
      'Remove --delete Shop: this change does not delete the data of "Shop".',
    ]);
  });
});
