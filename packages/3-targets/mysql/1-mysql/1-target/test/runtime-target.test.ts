import { describe, expect, it } from 'vitest';
import mysqlRuntimeTarget from '../src/core/runtime/runtime-target';

describe('the MySQL runtime target descriptor', () => {
  it('creates a MySQL target instance and contributes no runtime codecs of its own', () => {
    expect({
      kind: mysqlRuntimeTarget.kind,
      targetId: mysqlRuntimeTarget.targetId,
      codecs: mysqlRuntimeTarget.codecs(),
      instance: mysqlRuntimeTarget.create(),
    }).toEqual({
      kind: 'target',
      targetId: 'mysql',
      codecs: [],
      instance: { familyId: 'sql', targetId: 'mysql' },
    });
  });
});
