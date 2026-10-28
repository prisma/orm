import { describe, expect, it } from 'vitest';
import { sqliteAuthoringTypes } from '../src/core/authoring';

describe('sqliteAuthoringTypes', () => {
  it('contributes BigIntNumber as its only integer-representation type', () => {
    expect(sqliteAuthoringTypes.BigIntNumber.output).toEqual({
      codecId: 'sqlite/bigintnumber@1',
    });
    expect(sqliteAuthoringTypes).not.toHaveProperty('UnboundedInt');
  });
});
