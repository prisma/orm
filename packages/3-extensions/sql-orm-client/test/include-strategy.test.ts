import { describe, expect, it } from 'vitest';
import { selectIncludeStrategy } from '../src/include-strategy';
import { getTestContract } from './helpers';

const oneQueryIncludeCapabilities = {
  jsonAgg: true,
  outerReferencesInDerivedTables: true,
  jsonAggWithoutTruncation: true,
} as const;

function contractWithCapabilities(capabilities: Record<string, Record<string, unknown>>) {
  const contract = getTestContract();
  return { ...contract, capabilities } as unknown as typeof contract;
}

describe('selectIncludeStrategy', () => {
  it("chooses 'join' when the sql group reports all three capabilities", () => {
    expect(
      selectIncludeStrategy(contractWithCapabilities({ sql: oneQueryIncludeCapabilities })),
    ).toBe('join');
  });

  it.each(Object.keys(oneQueryIncludeCapabilities))(
    "chooses 'query' when %s is missing",
    (missing) => {
      const sql = Object.fromEntries(
        Object.entries(oneQueryIncludeCapabilities).filter(([key]) => key !== missing),
      );
      expect(selectIncludeStrategy(contractWithCapabilities({ sql }))).toBe('query');
    },
  );

  it.each(Object.keys(oneQueryIncludeCapabilities))(
    "chooses 'query' when %s is false",
    (disabled) => {
      const sql = { ...oneQueryIncludeCapabilities, [disabled]: false };
      expect(selectIncludeStrategy(contractWithCapabilities({ sql }))).toBe('query');
    },
  );

  it("chooses 'query' when a capability is reported only in another group", () => {
    const contract = contractWithCapabilities({
      sql: { outerReferencesInDerivedTables: true, jsonAggWithoutTruncation: true },
      postgres: { jsonAgg: true },
    });
    expect(selectIncludeStrategy(contract)).toBe('query');
  });

  it("chooses 'query' when the contract has no sql group", () => {
    expect(selectIncludeStrategy(contractWithCapabilities({}))).toBe('query');
  });
});
