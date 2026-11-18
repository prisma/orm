import { describe, expect, it } from 'vitest';
import { SqlIndexIR, type SqlIndexIRInput } from '../src/ir/sql-index-ir';
import { parseNaming } from '../src/naming';

type LooseIndexInput = Pick<SqlIndexIRInput, 'unique' | 'partial'> & {
  readonly name: string;
  readonly prefix?: string;
  readonly columns?: readonly string[];
  readonly expression?: string;
  readonly where?: string;
  readonly type?: string;
  readonly options?: Record<string, unknown>;
  readonly annotations?: SqlIndexIRInput['annotations'];
  readonly dependsOn?: SqlIndexIRInput['dependsOn'];
};

function index(input: LooseIndexInput): SqlIndexIR {
  const naming = parseNaming(input.name, input.prefix);
  if (naming === undefined) throw new Error(`bad flat naming: ${input.name} / ${input.prefix}`);
  const filled = {
    columns: input.columns !== undefined || input.expression !== undefined ? undefined : ['email'],
    expression: undefined,
    where: undefined,
    type: undefined,
    options: undefined,
    annotations: undefined,
    dependsOn: undefined,
    ...input,
    naming,
  };
  const { name: _name, prefix: _prefix, ...rest } = filled;
  return new SqlIndexIR(rest as SqlIndexIRInput);
}

function wireNamed(input: Partial<LooseIndexInput> & { readonly name: string }): SqlIndexIR {
  return index({ unique: false, partial: false, prefix: 'user_email_idx', ...input });
}

function exact(input: Partial<LooseIndexInput> & { readonly name: string }): SqlIndexIR {
  return index({ unique: false, partial: false, ...input });
}

const NAME = 'user_email_idx_46df9cad';

describe('SqlIndexIR', () => {
  it('id is the name (name identity), kind-prefixed against sibling collisions', () => {
    const idx = exact({ name: 'idx_users_email', columns: ['email'] });
    expect(idx.id).toBe('index:idx_users_email');
  });

  it('two same-tuple indexes with different names have distinct ids (twins are representable)', () => {
    const a = exact({ name: 'user_email_key', columns: ['email'], unique: true });
    const b = exact({ name: 'user_email_plain_idx', columns: ['email'] });
    expect(a.id).not.toBe(b.id);
  });

  it('rejects both columns and expression, and neither', () => {
    expect(() =>
      index({
        name: 'x',
        unique: false,
        partial: false,
        columns: ['email'],
        expression: 'lower(email)',
      }),
    ).toThrow(/exactly one of columns or expression/);
    const neither = {
      naming: { kind: 'exact', name: 'x' },
      where: undefined,
      unique: false,
      partial: false,
      type: undefined,
      options: undefined,
      annotations: undefined,
      dependsOn: undefined,
    };
    expect(() => new SqlIndexIR(neither as SqlIndexIRInput)).toThrow(
      /exactly one of columns or expression/,
    );
  });

  it('children is empty', () => {
    const idx = exact({ name: 'x', columns: ['email'] });
    expect(idx.children()).toEqual([]);
  });

  it('explicitly-undefined optional values leave the properties absent, not present-as-undefined', () => {
    const idx = exact({ name: 'user_email_idx', columns: ['email'] });
    for (const key of [
      'prefix',
      'expression',
      'where',
      'type',
      'options',
      'annotations',
      'dependsOn',
    ]) {
      expect(Object.hasOwn(idx, key)).toBe(false);
    }
    expect(Object.keys(idx).sort()).toEqual(['columns', 'name', 'nodeKind', 'unique']);
    expect(JSON.parse(JSON.stringify(idx))).toEqual({
      nodeKind: 'sql-index',
      name: 'user_email_idx',
      columns: ['email'],
      unique: false,
    });
  });

  describe('btree normalization at construction', () => {
    it("normalizes type 'btree' to absent (both derivation paths construct here)", () => {
      const authored = wireNamed({ name: NAME, columns: ['email'], type: 'btree' });
      expect(authored.type).toBeUndefined();
      expect(Object.hasOwn(authored, 'type')).toBe(false);
    });

    it('keeps non-default types', () => {
      const hashTyped = wireNamed({ name: NAME, columns: ['email'], type: 'hash' });
      expect(hashTyped.type).toBe('hash');
    });

    it("two 'btree' nodes are equal", () => {
      const a = wireNamed({ name: NAME, columns: ['email'], type: 'btree' });
      const b = exact({ name: NAME, columns: ['email'], type: 'btree' });
      expect(a.isEqualTo(b)).toBe(true);
    });
  });

  describe('contentEquals — the single node-owned relation', () => {
    it("a boolean option value equals its catalog reprint ('on'/'off')", () => {
      const authored = wireNamed({ name: NAME, columns: ['email'], options: { fastupdate: true } });
      const reprint = exact({ name: NAME, columns: ['email'], options: { fastupdate: 'on' } });
      expect(authored.isEqualTo(reprint)).toBe(true);

      const authoredOff = wireNamed({
        name: NAME,
        columns: ['email'],
        options: { fastupdate: false },
      });
      const reprintOff = exact({ name: NAME, columns: ['email'], options: { fastupdate: 'off' } });
      expect(authoredOff.isEqualTo(reprintOff)).toBe(true);
      expect(authoredOff.isEqualTo(reprint)).toBe(false);
    });

    it("an authored type 'btree' equals a normalized-away type through the seam", () => {
      const authored = wireNamed({ name: NAME, columns: ['email'], type: 'btree' });
      const live = exact({ name: NAME, columns: ['email'] });
      expect(authored.isEqualTo(live)).toBe(true);
      expect(live.isEqualTo(authored)).toBe(true);
    });

    it("columnPresence 'matching' refuses a column node against an expression node", () => {
      const columnsNode = wireNamed({ name: NAME, columns: ['email'] });
      const expressionNode = exact({ name: 'legacy_expr', expression: 'lower(email)' });
      expect(
        columnsNode.contentEquals(expressionNode, {
          columnPresence: 'matching',
          bodies: 'verbatim',
        }),
      ).toBe(false);
      // The differ's rule skips the tuple when either side is an expression.
      expect(
        columnsNode.contentEquals(expressionNode, {
          columnPresence: 'when-both-defined',
          bodies: 'ignored',
        }),
      ).toBe(true);
    });

    it("columnPresence 'matching' compares the tuple when both sides carry columns", () => {
      const email = wireNamed({ name: NAME, columns: ['email'] });
      const strictness = { columnPresence: 'matching', bodies: 'ignored' } as const;

      expect({
        sameTuple: email.contentEquals(exact({ name: NAME, columns: ['email'] }), strictness),
        differentTuple: email.contentEquals(exact({ name: NAME, columns: ['name'] }), strictness),
      }).toEqual({ sameTuple: true, differentTuple: false });
    });

    it("columnPresence 'matching' pairs two expression nodes on their bodies", () => {
      const expression = exact({ name: 'expr_idx', expression: 'lower(email)' });
      const strictness = { columnPresence: 'matching', bodies: 'verbatim' } as const;

      expect({
        sameBody: expression.contentEquals(
          exact({ name: 'expr_idx', expression: 'lower(email)' }),
          strictness,
        ),
        differentBody: expression.contentEquals(
          exact({ name: 'expr_idx', expression: 'upper(email)' }),
          strictness,
        ),
      }).toEqual({ sameBody: true, differentBody: false });
    });

    it('option bags with different key sets are unequal', () => {
      const oneOption = wireNamed({ name: NAME, columns: ['email'], options: { fillfactor: 70 } });

      expect({
        extraKey: oneOption.isEqualTo(
          exact({ name: NAME, columns: ['email'], options: { fillfactor: 70, fastupdate: true } }),
        ),
        renamedKey: oneOption.isEqualTo(
          exact({ name: NAME, columns: ['email'], options: { deduplicate_items: 70 } }),
        ),
      }).toEqual({ extraKey: false, renamedKey: false });
    });
  });

  describe('isEqualTo — both modes (structural attributes)', () => {
    it('true when unique/type/options/columns all match', () => {
      const a = wireNamed({ name: NAME, columns: ['email'], unique: true, type: 'gin' });
      const b = exact({ name: NAME, columns: ['email'], unique: true, type: 'gin' });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('a unique index and a non-unique index are not equal (symmetric)', () => {
      const uniqueIdx = wireNamed({ name: NAME, columns: ['email'], unique: true });
      const plainIdx = exact({ name: NAME, columns: ['email'] });
      expect(uniqueIdx.isEqualTo(plainIdx)).toBe(false);
      expect(plainIdx.isEqualTo(uniqueIdx)).toBe(false);
    });

    it('false when type differs (wire-named side detects drift)', () => {
      const a = wireNamed({ name: NAME, columns: ['email'], type: 'btree' });
      const b = exact({ name: NAME, columns: ['email'], type: 'gin' });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('false when options differ; loose String() coercion still applies', () => {
      const drifted = wireNamed({ name: NAME, columns: ['email'], options: { fillfactor: 90 } });
      const live = exact({ name: NAME, columns: ['email'], options: { fillfactor: '70' } });
      expect(drifted.isEqualTo(live)).toBe(false);

      const typed = wireNamed({ name: NAME, columns: ['email'], options: { fillfactor: 70 } });
      const stringly = exact({ name: NAME, columns: ['email'], options: { fillfactor: '70' } });
      expect(typed.isEqualTo(stringly)).toBe(true);
    });

    it('absent options and empty options compare equal', () => {
      const a = wireNamed({ name: NAME, columns: ['email'] });
      const b = exact({ name: NAME, columns: ['email'], options: {} });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('columns compare ordered-strict when both sides carry them', () => {
      const ab = wireNamed({ name: NAME, columns: ['a', 'b'] });
      const ba = exact({ name: NAME, columns: ['b', 'a'] });
      const abAgain = exact({ name: NAME, columns: ['a', 'b'] });
      expect(ab.isEqualTo(ba)).toBe(false);
      expect(ab.isEqualTo(abAgain)).toBe(true);
    });

    it('columns are skipped when either side is an expression node', () => {
      const wireNamedColumns = wireNamed({ name: NAME, columns: ['email'] });
      const liveExpression = exact({ name: NAME, expression: 'lower(email)' });
      expect(wireNamedColumns.isEqualTo(liveExpression)).toBe(true);
    });
  });

  describe('isEqualTo — wire mode never compares bodies', () => {
    it('expression and where drift is invisible to a wire-named expected node', () => {
      const expected = wireNamed({ name: NAME, expression: 'lower(email)', where: 'x > 1' });
      const actual = exact({ name: NAME, expression: 'upper(email)', where: 'x > 2' });
      expect(expected.isEqualTo(actual)).toBe(true);
    });
  });

  describe('isEqualTo — exact mode compares bodies byte-for-byte', () => {
    it('fires on expression reprint drift', () => {
      const expected = exact({ name: 'users_email_eq', expression: 'lower(email)' });
      const actual = exact({ name: 'users_email_eq', expression: 'lower((email)::text)' });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('fires on where drift', () => {
      const expected = exact({
        name: 'users_active_idx',
        columns: ['email'],
        where: '(deleted_at IS NULL)',
      });
      const actual = exact({
        name: 'users_active_idx',
        columns: ['email'],
        where: '(archived_at IS NULL)',
      });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('no normalization: whitespace variants of the same body are unequal', () => {
      const expected = exact({ name: 'users_email_eq', expression: 'lower(email)' });
      const actual = exact({ name: 'users_email_eq', expression: 'lower( email )' });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('absent bodies equal empty bodies (fields-only exact indexes stay equal)', () => {
      const expected = exact({ name: 'users_email_idx', columns: ['email'] });
      const actual = exact({ name: 'users_email_idx', columns: ['email'], where: '' });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('matching bodies are equal', () => {
      const expected = exact({
        name: 'users_email_eq',
        expression: 'lower(email)',
        where: '(deleted_at IS NULL)',
      });
      const actual = exact({
        name: 'users_email_eq',
        expression: 'lower(email)',
        where: '(deleted_at IS NULL)',
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });
  });

  describe('partial', () => {
    it('is readable, non-enumerable, and ignored by isEqualTo', () => {
      const partialIdx = wireNamed({ name: NAME, columns: ['email'], unique: true, partial: true });
      const totalIdx = exact({ name: NAME, columns: ['email'], unique: true });
      expect(partialIdx.partial).toBe(true);
      expect(totalIdx.partial).toBe(false);
      expect(Object.keys(partialIdx)).not.toContain('partial');
      expect(JSON.parse(JSON.stringify(partialIdx))).not.toHaveProperty('partial');
      expect(partialIdx.isEqualTo(totalIdx)).toBe(true);
      expect(totalIdx.isEqualTo(partialIdx)).toBe(true);
    });
  });

  describe('dependsOn', () => {
    const dependsOn = [
      [
        { nodeKind: 'sql-schema', id: 'database' },
        { nodeKind: 'sql-table', id: 'users' },
        { nodeKind: 'sql-column', id: 'column:email' },
      ],
    ];

    it('is readable, non-enumerable, and ignored by isEqualTo', () => {
      const withDeps = wireNamed({ name: NAME, columns: ['email'], dependsOn });
      const without = exact({ name: NAME, columns: ['email'] });
      expect(withDeps.dependsOn).toEqual(dependsOn);
      expect(without.dependsOn).toBeUndefined();
      expect(Object.keys(withDeps)).not.toContain('dependsOn');
      expect(JSON.parse(JSON.stringify(withDeps))).not.toHaveProperty('dependsOn');
      expect(withDeps.isEqualTo(without)).toBe(true);
    });
  });
});
