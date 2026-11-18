import { describe, expect, it } from 'vitest';
import { sqliteAuthoringTypes } from '../src/core/authoring';

describe('sqliteAuthoringTypes', () => {
  it('contributes the sql and temporal namespaces only; the scalar types are the target’s type constructors', () => {
    expect(Object.keys(sqliteAuthoringTypes)).toEqual(['sql', 'temporal']);
  });
});
