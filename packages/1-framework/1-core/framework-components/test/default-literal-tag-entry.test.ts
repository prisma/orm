import { describe, expect, it } from 'vitest';
import { jsonDefaultLiteralTagEntry } from '../src/exports/codec';
import {
  type ControlDefaultLiteralTagEntry,
  isDefaultLiteralTagLoweringEntry,
} from '../src/exports/control';

const loweringEntry: ControlDefaultLiteralTagEntry = {
  usage: 'sql`...`',
  documentation: 'Raw SQL.',
  lower: () => ({
    ok: true,
    value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
  }),
};

describe('isDefaultLiteralTagLoweringEntry', () => {
  it('accepts an entry that lowers its own body', () => {
    expect(isDefaultLiteralTagLoweringEntry(loweringEntry)).toBe(true);
  });

  it('refuses an entry that names a literal type', () => {
    expect(isDefaultLiteralTagLoweringEntry(jsonDefaultLiteralTagEntry())).toBe(false);
  });
});

describe('jsonDefaultLiteralTagEntry', () => {
  it('names the json literal type', () => {
    expect(jsonDefaultLiteralTagEntry()).toEqual({
      usage: 'json`...`',
      documentation: 'Reads the body as a JSON document and stores it as the default value.',
      literalType: 'json',
    });
  });
});
