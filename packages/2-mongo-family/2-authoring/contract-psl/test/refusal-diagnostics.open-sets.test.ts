import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { type IndexSite, refusalDiagnostic, type SchemaSites } from '../src/refusal-diagnostics';

const site = {
  source: { at: () => ({ filename: 'schema.prisma', range: {} }) },
  span: {},
  label: '@@index([email]) on model "User"',
} as unknown as IndexSite;

const sites: SchemaSites = {
  models: new Map([['User', { declaration: site, indexes: [site] }]]),
  fields: new Map(),
  enums: new Map(),
  valueObjects: new Map(),
};

describe('refusalDiagnostic for an index rule a later release adds', () => {
  it('words the rule by its name', () => {
    const diagnostic = refusalDiagnostic(
      {
        kind: 'indexShape',
        key: { kind: 'index', model: 'User', position: 0 },
        rule: 'future-rule',
        signature: '{ email: 1 }',
      },
      sites,
    );
    expect(diagnostic).toMatchObject({
      code: 'PSL_INVALID_INDEX',
      message: 'Index on model "User" breaks the index rule "future-rule"',
    });
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'words the index rule %s, an inherited property name, by its name',
    (rule) => {
      const diagnostic = refusalDiagnostic(
        {
          kind: 'indexShape',
          key: { kind: 'index', model: 'User', position: 0 },
          rule,
          signature: '{ email: 1 }',
        },
        sites,
      );
      expect(diagnostic).toMatchObject({
        message: `Index on model "User" breaks the index rule "${rule}"`,
      });
    },
  );

  it('treats a refusal of a kind it does not know as a bug of the release', () => {
    expect(() => refusalDiagnostic({ kind: '%future added value', key: undefined }, sites)).toThrow(
      InternalError,
    );
    expect(() =>
      refusalDiagnostic(
        { kind: 'validator', key: undefined, refusal: { kind: '%future added value' } },
        sites,
      ),
    ).toThrow(InternalError);
  });
});
