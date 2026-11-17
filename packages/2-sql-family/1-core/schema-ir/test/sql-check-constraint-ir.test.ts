import { describe, expect, it } from 'vitest';

import { SqlCheckConstraintIR } from '../src/ir/sql-check-constraint-ir';
import { computeCheckContentHash } from '../src/naming';

const expression = `"status" IN ('active', 'inactive')`;
const hash = computeCheckContentHash(expression);

function wireCheck(prefix: string, body: string): SqlCheckConstraintIR {
  return new SqlCheckConstraintIR({
    naming: { kind: 'wire', prefix, hash: computeCheckContentHash(body) },
    expression: body,
    dependsOn: undefined,
  });
}

function exactCheck(name: string, body: string): SqlCheckConstraintIR {
  return new SqlCheckConstraintIR({
    naming: { kind: 'exact', name },
    expression: body,
    dependsOn: undefined,
  });
}

describe('SqlCheckConstraintIR', () => {
  it('a wire naming flattens to name + prefix', () => {
    const check = wireCheck('T_status_check', expression);
    expect(check.name).toBe(`T_status_check_${hash}`);
    expect(check.prefix).toBe('T_status_check');
    expect(check.expression).toBe(expression);
  });

  it('an exact naming carries the name verbatim and no prefix', () => {
    const check = exactCheck('chk_status', expression);
    expect(check.name).toBe('chk_status');
    expect(check.prefix).toBeUndefined();
  });

  it('is frozen', () => {
    expect(Object.isFrozen(exactCheck('chk_status', expression))).toBe(true);
  });

  it('id is the constraint name, prefixed by kind', () => {
    expect(exactCheck('chk_status', expression).id).toBe('check:chk_status');
    expect(wireCheck('T_status_check', expression).id).toBe(`check:T_status_check_${hash}`);
  });

  it('children is empty (a check constraint is a leaf)', () => {
    expect(exactCheck('chk_status', expression).children()).toEqual([]);
  });

  describe('isEqualTo — wire-named receiver compares names only', () => {
    it('true for the same wire name', () => {
      expect(
        wireCheck('T_status_check', expression).isEqualTo(wireCheck('T_status_check', expression)),
      ).toBe(true);
    });

    it('true when the names agree but the expressions differ (the hash commits to content)', () => {
      const expected = wireCheck('T_status_check', expression);
      const live = new SqlCheckConstraintIR({
        naming: { kind: 'wire', prefix: 'T_status_check', hash },
        expression: `((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[]))`,
        dependsOn: undefined,
      });
      expect(expected.isEqualTo(live)).toBe(true);
    });

    it('true even when the live expression enumerates a different value set', () => {
      // What "compares names only" costs: a faithful reprint that has lost a
      // member still compares equal, because only the name is read.
      const expected = wireCheck('T_status_check', expression);
      const live = new SqlCheckConstraintIR({
        naming: { kind: 'wire', prefix: 'T_status_check', hash },
        expression: `((status)::text = 'active'::text)`,
        dependsOn: undefined,
      });
      expect(expected.isEqualTo(live)).toBe(true);
    });

    it('false when the prefix differs', () => {
      expect(
        wireCheck('T_status_check', expression).isEqualTo(wireCheck('T_state_check', expression)),
      ).toBe(false);
    });

    it('false when the expression changes the hash', () => {
      expect(
        wireCheck('T_status_check', expression).isEqualTo(
          wireCheck('T_status_check', `"status" IN ('active')`),
        ),
      ).toBe(false);
    });
  });

  describe('isEqualTo — exact-named receiver compares the expression verbatim', () => {
    it('true for a byte-identical expression', () => {
      expect(exactCheck('chk', expression).isEqualTo(exactCheck('chk', expression))).toBe(true);
    });

    it('false for a reformatted expression (no normalization)', () => {
      expect(
        exactCheck('chk', expression).isEqualTo(
          exactCheck('chk', `"status"  IN ('active', 'inactive')`),
        ),
      ).toBe(false);
    });

    it('false for a different expression', () => {
      expect(
        exactCheck('chk', expression).isEqualTo(exactCheck('chk', `"status" IN ('active')`)),
      ).toBe(false);
    });
  });
});
