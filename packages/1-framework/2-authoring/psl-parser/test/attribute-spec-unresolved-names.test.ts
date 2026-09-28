import { expect, it } from 'vitest';
import { identifier } from '../src/attribute-spec/combinators/identifier';

it.each([
  { spec: identifier(), allowed: true },
  { spec: identifier({}), allowed: true },
  { spec: identifier({ allowsUnresolvedName: true }), allowed: true },
  { spec: identifier({ allowsUnresolvedName: false }), allowed: false },
  { spec: identifier('External', { documentation: 'external' }), allowed: true },
  {
    spec: identifier('External', { documentation: 'external', allowsUnresolvedName: false }),
    allowed: false,
  },
])('configures $spec.label unresolved-name policy as $allowed', ({ spec, allowed }) => {
  expect(spec.allowsUnresolvedName).toBe(allowed);
});
