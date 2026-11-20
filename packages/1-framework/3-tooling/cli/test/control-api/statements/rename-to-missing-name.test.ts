import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { resolveStatements } from '../../../src/control-api/statements/resolve-statements';
import { askedAbout } from './plan-question-fixtures';
import { contractOf, failureShape } from './statement-fixtures';

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
        'If enum value "Status.ARCHIVED" was renamed to "Status.RETIRED": --rename Status.ARCHIVED:Status.RETIRED',
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
        'the contract has no field "Shop.nope" to rename "Shop.legacy" to. The contract adds fields "Shop.rating" and "Shop.score". If field "Shop.legacy" was renamed to "Shop.nope", add field "Shop.nope" to the contract, run `{bin} contract emit`, and run this command again.',
      hadBefore:
        'the contract had field "Shop.id" before this change too, so it is not the new name of "Shop.legacy".',
      otherOldName:
        'The rename\'s old name is not "Shop.legacy". Write it as Shop.legacy:Shop.<new name>.',
      fits: undefined,
    });
  });
});
