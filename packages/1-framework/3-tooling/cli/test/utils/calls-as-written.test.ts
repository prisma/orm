import { describe, expect, it } from 'vitest';
import { withEditsAsWritten } from '../../src/utils/calls-as-written';

describe('withEditsAsWritten', () => {
  it('quotes each call of an edit as the written migration.ts holds it', async () => {
    const facts = await withEditsAsWritten({
      rowsHoldingValue: [
        {
          enumValue: 'Status.DRAFT',
          enumName: 'Status',
          value: 'draft',
          rows: 1,
          keepDataEdit: {
            remove:
              'this.removeStoredValue({ schema: "public", table: "site", column: "history", value: "draft", path: "$[*].kind" })',
            replaceWith:
              'this.replaceStoredValue({ schema: "public", table: "site", column: "history", from: "draft", to: "<stored value>", path: "$[*].kind" })',
          },
        },
      ],
    });

    expect(facts.rowsHoldingValue?.[0]?.keepDataEdit).toEqual({
      remove: [
        'this.removeStoredValue({',
        "        schema: 'public',",
        "        table: 'site',",
        "        column: 'history',",
        "        value: 'draft',",
        "        path: '$[*].kind',",
        '      })',
      ].join('\n'),
      replaceWith: [
        'this.replaceStoredValue({',
        "        schema: 'public',",
        "        table: 'site',",
        "        column: 'history',",
        "        from: 'draft',",
        "        to: '<stored value>',",
        "        path: '$[*].kind',",
        '      })',
      ].join('\n'),
    });
  });

  it('leaves facts without stored values as they are', async () => {
    const facts = {};
    expect(await withEditsAsWritten(facts)).toBe(facts);
  });
});
