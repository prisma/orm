import type { PreparedParamRef } from '@internal/sql-relational-core/ast';
import { expect, it } from 'vitest';
import { buildBindSiteParams } from '../src/prepared/bind-site-params';

it('carries declaration nullability and codec metadata into prepared references', () => {
  const params = buildBindSiteParams({
    required: 'pg/text@1',
    optional: { codecId: 'pg/text@1', nullable: true, typeParams: { length: 12 } },
    explicit: { codecId: 'pg/text@1', nullable: false },
  });
  expect(
    Object.entries(params).map(([name, param]) => {
      const ast = param.buildAst() as PreparedParamRef;
      return [name, param.returnType.nullable, ast.nullable, ast.codec];
    }),
  ).toEqual([
    ['required', false, false, { codecId: 'pg/text@1' }],
    ['optional', true, true, { codecId: 'pg/text@1', typeParams: { length: 12 } }],
    ['explicit', false, false, { codecId: 'pg/text@1' }],
  ]);
});
