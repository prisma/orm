import type { AuthoringWarning } from '@internal/framework-components/authoring';
import {
  computeCheckContentHash,
  nameOf,
  parseNaming,
  truncateToWireNamePrefixBytes,
  WIRE_NAME_PREFIX_MAX_BYTES,
} from '@internal/sql-schema-ir/naming';
import { describe, expect, it, vi } from 'vitest';
import { lowerAuthoredCheck } from '../src/authored-check-naming';

describe('lowerAuthoredCheck — wire naming (name:)', () => {
  it('produces name_<8hex>, hashed over the expression, and parseNaming round-trips it', () => {
    const lowered = lowerAuthoredCheck('order', {
      expression: 'total > 0',
      name: 'order_total_positive',
      map: undefined,
    });
    expect(lowered).toEqual({
      naming: { kind: 'wire', prefix: 'order_total_positive', hash: 'd7e9fd79' },
      expression: 'total > 0',
    });

    const fullName = nameOf(lowered.naming);
    expect(fullName).toBe(`order_total_positive_${computeCheckContentHash('total > 0')}`);
    expect(parseNaming(fullName, 'order_total_positive')).toEqual(lowered.naming);
  });

  it('changing the expression changes the hash; changing only the name prefix does not', () => {
    const baseline = lowerAuthoredCheck('order', {
      expression: 'total > 0',
      name: 'order_total_positive',
      map: undefined,
    });
    const changedExpression = lowerAuthoredCheck('order', {
      expression: 'total > 1',
      name: 'order_total_positive',
      map: undefined,
    });
    const changedPrefixOnly = lowerAuthoredCheck('order', {
      expression: 'total > 0',
      name: 'positive_total',
      map: undefined,
    });

    expect(baseline.naming).toEqual({
      kind: 'wire',
      prefix: 'order_total_positive',
      hash: 'd7e9fd79',
    });
    expect(changedExpression.naming).toEqual({
      kind: 'wire',
      prefix: 'order_total_positive',
      hash: '787fc918',
    });
    expect(changedPrefixOnly.naming).toEqual({
      kind: 'wire',
      prefix: 'positive_total',
      hash: 'd7e9fd79',
    });
  });
});

describe('lowerAuthoredCheck — exact naming (map:)', () => {
  it('produces the verbatim physical name with no suffix and no prefix', () => {
    const collected: AuthoringWarning[] = [];
    const lowered = lowerAuthoredCheck(
      'legacy_order',
      { expression: '(total > (0)::numeric)', map: 'positive_total', name: undefined },
      { push: (w) => collected.push(w) },
    );
    expect(lowered).toEqual({
      naming: { kind: 'exact', name: 'positive_total' },
      expression: '(total > (0)::numeric)',
    });
  });
});

describe('lowerAuthoredCheck — wire-prefix byte budget', () => {
  it('an over-budget authored prefix throws while a derived prefix of the same length truncates', () => {
    const overBudget = 'a'.repeat(WIRE_NAME_PREFIX_MAX_BYTES + 6);

    expect(() =>
      lowerAuthoredCheck('order', { expression: 'total > 0', name: overBudget, map: undefined }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.WIRE_NAME_PREFIX_TOO_LONG' }));

    // The derived-naming counterpart to the same over-budget input: it
    // truncates rather than throwing, because a derived prefix has no
    // author who could shorten it (ADR 244).
    expect(truncateToWireNamePrefixBytes(overBudget)).toBe('a'.repeat(WIRE_NAME_PREFIX_MAX_BYTES));
  });
});

describe('lowerAuthoredCheck — exact-name body warning', () => {
  it('map: mints the exact-name body warning', () => {
    const collected: AuthoringWarning[] = [];
    lowerAuthoredCheck(
      'order',
      { expression: 'total > 0', map: 'positive_total', name: undefined },
      { push: (w) => collected.push(w) },
    );
    expect(collected).toEqual([
      expect.objectContaining({
        code: 'PN_EXACT_NAME_BODY_COMPARISON',
        item: 'check "positive_total"',
      }),
    ]);
  });

  it('name: does not mint the exact-name body warning', () => {
    const collected: AuthoringWarning[] = [];
    lowerAuthoredCheck(
      'order',
      { expression: 'total > 0', name: 'order_total_positive', map: undefined },
      { push: (w) => collected.push(w) },
    );
    expect(collected).toEqual([]);
  });

  it('pins the warning wording, in the same voice as the index and policy warnings', () => {
    const collected: AuthoringWarning[] = [];
    lowerAuthoredCheck(
      'order',
      { expression: 'total > 0', map: 'positive_total', name: undefined },
      { push: (w) => collected.push(w) },
    );
    expect(collected[0]?.message).toBe(
      'check "positive_total" uses map: with a SQL body. Drift detection compares the authored ' +
        "SQL text byte-for-byte against Postgres's reprinted form, which is only reliable when the " +
        'text was captured by contract infer. For hand-authored definitions, use name: and let ' +
        'Prisma 8 manage the physical name; to migrate an adopted check to wire naming, replace ' +
        'map: with name: (keeping the body text unchanged) and apply the resulting rename migration.',
    );
  });

  it('falls back to flushAuthoringWarnings when no sink is provided', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      lowerAuthoredCheck('order', {
        expression: 'total > 0',
        map: 'positive_total',
        name: undefined,
      });
      expect(emitWarning).toHaveBeenCalledTimes(1);
      expect(emitWarning.mock.calls[0]?.[1]).toEqual({ code: 'PN_EXACT_NAME_BODY_COMPARISON' });
    } finally {
      emitWarning.mockRestore();
    }
  });
});

describe('lowerAuthoredCheck — cross-field guards', () => {
  it('rejects map combined with name', () => {
    expect(() =>
      lowerAuthoredCheck('order', {
        expression: 'total > 0',
        map: 'positive_total',
        name: 'order_total_positive',
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: expect.stringContaining('map and name are mutually exclusive'),
      }),
    );
  });

  it('rejects neither map nor name', () => {
    expect(() =>
      lowerAuthoredCheck('order', { expression: 'total > 0', map: undefined, name: undefined }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: expect.stringContaining('requires an explicit name'),
      }),
    );
  });

  it('rejects an empty expression', () => {
    expect(() =>
      lowerAuthoredCheck('order', {
        expression: '',
        name: 'order_total_positive',
        map: undefined,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: expect.stringContaining('must not be empty'),
      }),
    );
  });

  it('rejects a whitespace-only expression', () => {
    expect(() =>
      lowerAuthoredCheck('order', {
        expression: '   \n\t ',
        name: 'order_total_positive',
        map: undefined,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: expect.stringContaining('must not be empty'),
      }),
    );
  });
});
