import { RawAggregateCommand } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { documentsFitValidator } from '../src/core/document-checks';

describe('documentsFitValidator', () => {
  it('matches one document the validator rejects, and expects none', () => {
    const validator = { $jsonSchema: { required: ['_id', 'plan'] } };
    const check = documentsFitValidator('users', validator);
    const command = 'command' in check.source ? check.source.command : undefined;

    expect({
      collection: command instanceof RawAggregateCommand ? command.collection : undefined,
      pipeline: command instanceof RawAggregateCommand ? command.pipeline : undefined,
      expect: check.expect,
    }).toEqual({
      collection: 'users',
      pipeline: [{ $match: { $nor: [validator] } }, { $limit: 1 }],
      expect: 'notExists',
    });
  });
});
