import { PreparedParamRef } from '@internal/sql-relational-core/ast';
import { expect, it } from 'vitest';
import { buildBindSiteParams } from '../src/prepared/bind-site-params';

it('carries declaration nullability into the frozen prepared AST reference', () => {
  const params = buildBindSiteParams({
    required: 'pg/text@1',
    optional: { codecId: 'pg/text@1', nullable: true, typeParams: { length: 12 } },
    explicit: { codecId: 'pg/text@1', nullable: false },
  });
  for (const [name, nullable] of [
    ['required', false],
    ['optional', true],
    ['explicit', false],
  ] as const) {
    const ast = params[name].buildAst();
    expect(ast).toBeInstanceOf(PreparedParamRef);
    expect(ast).toMatchObject({ name, nullable });
    expect(params[name].returnType.nullable).toBe(nullable);
    expect(Object.isFrozen(ast)).toBe(true);
  }
  expect(params.optional.buildAst()).toMatchObject({
    codec: { codecId: 'pg/text@1', typeParams: { length: 12 } },
  });
});
