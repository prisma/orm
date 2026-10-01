import { describe, expect, it } from 'vitest';
import type { DiffableNode, SchemaDiffIssue, SchemaNodeRef } from '../src/control/schema-diff';
import { diffSchemas, issueOutcome, SchemaDiff } from '../src/control/schema-diff';

/** A synthetic root node whose `isEqualTo` is always true — used to wrap flat node lists. */
function rootOf(nodes: readonly DiffableNode[]): DiffableNode {
  return {
    id: 'root',
    nodeKind: 'root',
    isEqualTo(): boolean {
      return true;
    },
    children(): readonly DiffableNode[] {
      return nodes;
    },
  };
}

function makeNode(
  nodeId: string,
  body = '',
  childNodes: readonly DiffableNode[] = [],
  nodeKind = 'widget',
  dependsOn?: readonly SchemaNodeRef[],
): DiffableNode {
  return {
    id: nodeId,
    nodeKind,
    ...(dependsOn !== undefined ? { dependsOn } : {}),
    children(): readonly DiffableNode[] {
      return childNodes;
    },
    isEqualTo(other: DiffableNode): boolean {
      return (
        nodeId === other.id &&
        nodeKind === other.nodeKind &&
        body === (other as typeof this & { _body?: string })._body
      );
    },
    _body: body,
  } as DiffableNode & { _body: string };
}

describe('diffSchemas', () => {
  it('returns empty when expected and actual are both empty', () => {
    expect(diffSchemas(rootOf([]), rootOf([]))).toEqual([]);
  });

  it('reports missing when an expected node has no match in actual', () => {
    const expected = [makeNode('public/policy/read_own_abcd1234')];
    const issues = diffSchemas(rootOf(expected), rootOf([]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: ['root', 'public/policy/read_own_abcd1234'],
    });
  });

  it('reports extra when an actual node has no match in expected', () => {
    const actual = [makeNode('public/policy/stale_policy_deadbeef')];
    const issues = diffSchemas(rootOf([]), rootOf(actual));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: ['root', 'public/policy/stale_policy_deadbeef'],
    });
  });

  it('reports mismatch when both sides have the node but isEqualTo returns false', () => {
    const expected = [makeNode('public/policy/read_own_abcd1234', 'body-v1')];
    const actual = [makeNode('public/policy/read_own_abcd1234', 'body-v2')];
    const issues = diffSchemas(rootOf(expected), rootOf(actual));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: ['root', 'public/policy/read_own_abcd1234'],
    });
  });

  it('returns no issues when expected and actual match exactly', () => {
    const node = makeNode('public/policy/read_own_abcd1234', 'same-body');
    const expected = [node];
    const actual = [makeNode('public/policy/read_own_abcd1234', 'same-body')];
    const issues = diffSchemas(rootOf(expected), rootOf(actual));
    expect(issues).toEqual([]);
  });

  it('handles a mix of missing, extra, and mismatch in one call', () => {
    const expected = [
      makeNode('ns/widget/alpha', 'v1'),
      makeNode('ns/widget/beta', 'same'),
      makeNode('ns/widget/gamma', 'body'),
    ];
    const actual = [
      makeNode('ns/widget/alpha', 'v2'),
      makeNode('ns/widget/beta', 'same'),
      makeNode('ns/widget/delta', 'extra'),
    ];
    const issues = diffSchemas(rootOf(expected), rootOf(actual));
    expect(issues).toHaveLength(3);
    const byKey = Object.fromEntries(
      issues.map((i) => [i.path[i.path.length - 1], issueOutcome(i)]),
    );
    expect(byKey).toEqual({
      'ns/widget/alpha': 'not-equal',
      'ns/widget/gamma': 'not-found',
      'ns/widget/delta': 'not-expected',
    });
  });

  it('returns issues for all expected nodes when actual is empty', () => {
    const expected = [makeNode('ns/widget/zzz'), makeNode('ns/widget/aaa')];
    const issues = diffSchemas(rootOf(expected), rootOf([]));
    const keys = new Set(issues.map((i) => i.path[i.path.length - 1]));
    expect(keys).toEqual(new Set(['ns/widget/aaa', 'ns/widget/zzz']));
    expect(issues).toHaveLength(2);
  });

  it('issues do not carry a message field', () => {
    const issues = diffSchemas(rootOf([makeNode('ns/x/y')]), rootOf([]));
    expect(issues[0]).not.toHaveProperty('message');
  });

  it('missing issue carries expected node ref but no actual', () => {
    const expectedNode = makeNode('public/policy/read_own_abcd1234');
    const issues = diffSchemas(rootOf([expectedNode]), rootOf([]));
    const issue = issues[0] as SchemaDiffIssue;
    expect(issue.expected).toBe(expectedNode);
    expect(issue.actual).toBeUndefined();
  });

  it('extra issue carries actual node ref but no expected', () => {
    const actualNode = makeNode('public/policy/stale_policy_deadbeef');
    const issues = diffSchemas(rootOf([]), rootOf([actualNode]));
    const issue = issues[0] as SchemaDiffIssue;
    expect(issue.actual).toBe(actualNode);
    expect(issue.expected).toBeUndefined();
  });

  it('mismatch issue carries both expected and actual node refs', () => {
    const expectedNode = makeNode('public/policy/read_own_abcd1234', 'body-v1');
    const actualNode = makeNode('public/policy/read_own_abcd1234', 'body-v2');
    const issues = diffSchemas(rootOf([expectedNode]), rootOf([actualNode]));
    const issue = issues[0] as SchemaDiffIssue;
    expect(issue.expected).toBe(expectedNode);
    expect(issue.actual).toBe(actualNode);
  });

  it('local keys that are prefixes of each other do not collide', () => {
    // 'pol' is a prefix of 'policy' — the differ must not conflate them.
    const nodeA = makeNode('pol/icy');
    const nodeB = makeNode('policy/x');
    const issues = diffSchemas(rootOf([nodeA]), rootOf([nodeB]));
    expect(issues).toHaveLength(2);
    const changes = new Set(issues.map((i) => issueOutcome(i)));
    expect(changes).toEqual(new Set(['not-found', 'not-expected']));
  });

  it('throws when two siblings share the same id in expected', () => {
    const a = makeNode('public/policy/dup_name');
    const b = makeNode('public/policy/dup_name');
    expect(() => diffSchemas(rootOf([a, b]), rootOf([]))).toThrow(
      'diffSchemas: duplicate id among siblings',
    );
  });

  it('throws when two siblings share the same id in actual', () => {
    const a = makeNode('public/policy/dup_name');
    const b = makeNode('public/policy/dup_name');
    expect(() => diffSchemas(rootOf([]), rootOf([a, b]))).toThrow(
      'diffSchemas: duplicate id among siblings',
    );
  });

  it('throws when two siblings share the same id AND the same nodeKind (genuine duplicate)', () => {
    const a = makeNode('public', 'a', [], 'role');
    const b = makeNode('public', 'b', [], 'role');
    expect(() => diffSchemas(rootOf([a, b]), rootOf([]))).toThrow(
      'diffSchemas: duplicate id among siblings',
    );
  });

  it('a same-id sibling pair with different nodeKind does not throw and pairs independently (role "public" vs namespace "public")', () => {
    const role = makeNode('public', 'role-body', [], 'role');
    const namespace = makeNode('public', 'namespace-body', [], 'namespace');
    const expected = [role, namespace];
    const actual = [
      makeNode('public', 'role-body', [], 'role'),
      makeNode('public', 'namespace-body-v2', [], 'namespace'),
    ];

    const issues = diffSchemas(rootOf(expected), rootOf(actual));

    // The role pairs cleanly (equal bodies); the namespace pairs and mismatches.
    // Neither is reported as missing/extra — proof the two same-id, different-kind
    // siblings were never conflated into one map slot.
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: ['root', 'public'] });
    expect((issues[0]?.expected as DiffableNode | undefined)?.nodeKind).toBe('namespace');
  });

  it('a nodeKind-only-different sibling pair reports missing+extra when one side lacks the counterpart kind', () => {
    // Expected has only a role named "public"; actual has only a namespace named
    // "public". Same id, different nodeKind on each side — they must not pair
    // against each other; each is reported independently.
    const expected = [makeNode('public', 'role-body', [], 'role')];
    const actual = [makeNode('public', 'namespace-body', [], 'namespace')];

    const issues = diffSchemas(rootOf(expected), rootOf(actual));

    expect(issues).toHaveLength(2);
    const changes = new Set(issues.map((i) => issueOutcome(i)));
    expect(changes).toEqual(new Set(['not-found', 'not-expected']));
  });

  it('descends into a matched pair and reports one issue at the child path (AC-2)', () => {
    // A parent present on both sides whose id() matches and isEqualTo is true,
    // but whose children differ on one child. diffSchemas descends the matched
    // pair and reports exactly one issue, at the child's path.
    const expectedChild = makeNode('present_child', 'same');
    const actualChild = makeNode('present_child', 'same');
    const missingChild = makeNode('only_in_expected', 'x');

    const expectedParent = makeNode('parent', 'parent-body', [expectedChild, missingChild]);
    const actualParent = makeNode('parent', 'parent-body', [actualChild]);

    const issues = diffSchemas(rootOf([expectedParent]), rootOf([actualParent]));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: ['root', 'parent', 'only_in_expected'],
    });
  });

  it('emits mismatch at node path AND child-level issues when diffing two nodes directly', () => {
    // Proves diffSchemas compares the given nodes themselves, not just their children.
    // tableA and tableB share the same id() but isEqualTo is false (different body).
    // Their children also differ (one column only on tableA).
    const onlyInA = makeNode('only_in_a', 'col');
    const shared = makeNode('shared_col', 'same');

    const tableA = makeNode('users', 'body-v1', [shared, onlyInA]);
    const tableB = makeNode('users', 'body-v2', [makeNode('shared_col', 'same')]);

    const issues = diffSchemas(tableA, tableB);

    expect(issues).toHaveLength(2);
    const byKey = Object.fromEntries(
      issues.map((i) => [i.path[i.path.length - 1], issueOutcome(i)]),
    );
    expect(byKey['users']).toBe('not-equal');
    expect(byKey['only_in_a']).toBe('not-found');
  });

  it('total descent: missing subtree emits one issue per node in the subtree', () => {
    const grandchildA = makeNode('grandchild_a', 'leaf');
    const grandchildB = makeNode('grandchild_b', 'leaf');
    const child = makeNode('child', 'body', [grandchildA, grandchildB]);

    const issues = diffSchemas(rootOf([child]), rootOf([]));

    expect(issues).toHaveLength(3);
    const paths = issues.map((i) => i.path.join('/'));
    expect(paths).toContain('root/child');
    expect(paths).toContain('root/child/grandchild_a');
    expect(paths).toContain('root/child/grandchild_b');
    expect(issues.every((i) => issueOutcome(i) === 'not-found')).toBe(true);
  });

  it('total descent: extra subtree emits one issue per node in the subtree', () => {
    const grandchildA = makeNode('grandchild_a', 'leaf');
    const grandchildB = makeNode('grandchild_b', 'leaf');
    const child = makeNode('child', 'body', [grandchildA, grandchildB]);

    const issues = diffSchemas(rootOf([]), rootOf([child]));

    expect(issues).toHaveLength(3);
    const paths = issues.map((i) => i.path.join('/'));
    expect(paths).toContain('root/child');
    expect(paths).toContain('root/child/grandchild_a');
    expect(paths).toContain('root/child/grandchild_b');
    expect(issues.every((i) => issueOutcome(i) === 'not-expected')).toBe(true);
  });

  it('missing leaf still emits exactly one issue (behavior-preserving)', () => {
    const leaf = makeNode('lone_leaf', 'data');
    const issues = diffSchemas(rootOf([leaf]), rootOf([]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: ['root', 'lone_leaf'],
    });
  });

  describe('dependsOn mirroring', () => {
    function findIssue(
      issues: readonly SchemaDiffIssue[],
      lastPathSegment: string,
    ): SchemaDiffIssue {
      const issue = issues.find((i) => i.path[i.path.length - 1] === lastPathSegment);
      if (issue === undefined) throw new Error(`no issue found ending in "${lastPathSegment}"`);
      return issue;
    }

    it('a node with no dependsOn produces an issue with no dependsOn field', () => {
      const issues = diffSchemas(rootOf([makeNode('lone_leaf', 'data')]), rootOf([]));
      expect(issues[0]).not.toHaveProperty('dependsOn');
    });

    it('a ref whose target also produced an issue is kept, resolved to that issue path', () => {
      const table = makeNode('tableA', 'body', [], 'table');
      const fk = makeNode('fk1', 'body', [], 'fk', [
        [
          { nodeKind: 'root', id: 'root' },
          { nodeKind: 'table', id: 'tableA' },
        ],
      ]);
      const issues = diffSchemas(rootOf([table, fk]), rootOf([]));
      expect(findIssue(issues, 'fk1').dependsOn).toEqual([['root', 'tableA']]);
    });

    it('a ref whose target produced no issue is dropped (satisfied by reality)', () => {
      const tableExpected = makeNode('tableA', 'same', [], 'table');
      const tableActual = makeNode('tableA', 'same', [], 'table');
      const fk = makeNode('fk1', 'body', [], 'fk', [
        [
          { nodeKind: 'root', id: 'root' },
          { nodeKind: 'table', id: 'tableA' },
        ],
      ]);
      const issues = diffSchemas(rootOf([tableExpected, fk]), rootOf([tableActual]));
      expect(findIssue(issues, 'fk1')).not.toHaveProperty('dependsOn');
    });

    it('a ref whose target path matches but nodeKind differs is dropped', () => {
      // A role happens to share the id "tableA" with what the ref names as a
      // "table" — same path, wrong kind. The ref must not resolve to it.
      const role = makeNode('tableA', 'body', [], 'role');
      const fk = makeNode('fk1', 'body', [], 'fk', [
        [
          { nodeKind: 'root', id: 'root' },
          { nodeKind: 'table', id: 'tableA' },
        ],
      ]);
      const issues = diffSchemas(rootOf([role, fk]), rootOf([]));
      expect(findIssue(issues, 'fk1')).not.toHaveProperty('dependsOn');
    });

    it('keeps only the refs that resolve, out of several', () => {
      const tableExpected = makeNode('tableA', 'same', [], 'table');
      const tableActual = makeNode('tableA', 'same', [], 'table');
      const role = makeNode('app_user', 'body', [], 'role');
      const policy = makeNode('policy1', 'body', [], 'policy', [
        [
          { nodeKind: 'root', id: 'root' },
          { nodeKind: 'table', id: 'tableA' },
        ],
        [
          { nodeKind: 'root', id: 'root' },
          { nodeKind: 'role', id: 'app_user' },
        ],
      ]);
      const issues = diffSchemas(rootOf([tableExpected, role, policy]), rootOf([tableActual]));
      expect(findIssue(issues, 'policy1').dependsOn).toEqual([['root', 'app_user']]);
    });

    it('does not reorder issues', () => {
      const a = makeNode('a', 'v', [], 'widget');
      const b = makeNode('b', 'v', [], 'widget', [
        [
          { nodeKind: 'root', id: 'root' },
          { nodeKind: 'widget', id: 'a' },
        ],
      ]);
      const issues = diffSchemas(rootOf([a, b]), rootOf([]));
      expect(issues.map((i) => i.path[i.path.length - 1])).toEqual(['a', 'b']);
    });

    it('resolves to the right sibling when a role and a namespace share an id', () => {
      // Two siblings "public" — a role and a namespace — occupy the same
      // id-path. A ref whose terminal kind is `role` must resolve to the role,
      // not be defeated by the namespace sharing the path.
      const role = makeNode('public', 'role-body', [], 'role');
      const namespace = makeNode('public', 'namespace-body', [], 'namespace');
      const policy = makeNode('policy1', 'body', [], 'policy', [
        [
          { nodeKind: 'root', id: 'root' },
          { nodeKind: 'role', id: 'public' },
        ],
      ]);
      const issues = diffSchemas(rootOf([role, namespace, policy]), rootOf([]));
      expect(findIssue(issues, 'policy1').dependsOn).toEqual([['root', 'public']]);
    });

    it('a ref to a kind absent among same-id siblings is dropped', () => {
      // Only a namespace "public" exists; a ref whose terminal kind is `role`
      // finds no matching sibling and is dropped (satisfied by reality).
      const namespace = makeNode('public', 'namespace-body', [], 'namespace');
      const policy = makeNode('policy1', 'body', [], 'policy', [
        [
          { nodeKind: 'root', id: 'root' },
          { nodeKind: 'role', id: 'public' },
        ],
      ]);
      const issues = diffSchemas(rootOf([namespace, policy]), rootOf([]));
      expect(findIssue(issues, 'policy1')).not.toHaveProperty('dependsOn');
    });
  });
});

function makeSchemaDiffIssue(path: readonly string[]): SchemaDiffIssue {
  return { path };
}

describe('SchemaDiff', () => {
  it('exposes the issues it was constructed with', () => {
    const issues = [makeSchemaDiffIssue(['root', 'p'])];
    const diff = new SchemaDiff(issues);
    expect(diff.issues).toBe(issues);
  });

  it('filter narrows the issue list', () => {
    const keep = makeSchemaDiffIssue(['root', 'keep']);
    const drop = makeSchemaDiffIssue(['root', 'drop']);
    const diff = new SchemaDiff([keep, drop]);

    const filtered = diff.filter((issue) => issue.path.includes('keep'));

    expect(filtered.issues).toEqual([keep]);
  });

  it('filter returns a new SchemaDiff, not a mutation of the original', () => {
    const diff = new SchemaDiff([makeSchemaDiffIssue(['root', 'a'])]);
    const filtered = diff.filter(() => false);
    expect(filtered).not.toBe(diff);
    expect(diff.issues).toHaveLength(1);
    expect(filtered.issues).toHaveLength(0);
  });

  it('filter on an empty diff returns an empty diff', () => {
    const diff = new SchemaDiff([]);
    const filtered = diff.filter(() => true);
    expect(filtered.issues).toEqual([]);
  });
});

describe('diffSchemas mismatch explanations', () => {
  function explainedNode(body: string, explanation: string | undefined): DiffableNode {
    return {
      id: 'default',
      nodeKind: 'widget',
      children: () => [],
      isEqualTo: (other) => other.id === 'default' && body === 'same',
      explainMismatch: () => explanation,
    };
  }

  it('carries the explanation the expected node gives for a mismatch', () => {
    expect(
      diffSchemas(
        rootOf([explainedNode('old', 'the contract text is refused')]),
        rootOf([makeNode('default')]),
      ),
    ).toMatchObject([{ path: ['root', 'default'], explanation: 'the contract text is refused' }]);
  });

  it('carries the explanation the expected node gives when the actual side lacks it', () => {
    expect(
      diffSchemas(rootOf([explainedNode('old', 'the contract text is refused')]), rootOf([])),
    ).toMatchObject([{ path: ['root', 'default'], explanation: 'the contract text is refused' }]);
  });

  it('carries no explanation when the expected node gives none', () => {
    const [issue] = diffSchemas(
      rootOf([explainedNode('old', undefined)]),
      rootOf([makeNode('default')]),
    );
    expect(issue).not.toHaveProperty('explanation');
  });
});
