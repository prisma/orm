import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { renderImports } from '../src/render-imports';

describe('renderImports', () => {
  it('returns the empty string for an empty requirement list', () => {
    expect(renderImports([])).toBe('');
  });

  it('emits a named import for a single requirement', () => {
    const out = renderImports([{ moduleSpecifier: 'm', symbol: 'a' }]);
    expect(out).toBe("import { a } from 'm';");
  });

  it('aggregates named symbols per module, sorted alphabetically', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'c' },
      { moduleSpecifier: 'm', symbol: 'a' },
      { moduleSpecifier: 'm', symbol: 'b' },
    ]);
    expect(out).toBe("import { a, b, c } from 'm';");
  });

  it('deduplicates repeated named symbols within a module', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'a' },
      { moduleSpecifier: 'm', symbol: 'a' },
    ]);
    expect(out).toBe("import { a } from 'm';");
  });

  it('emits modules in alphabetical order', () => {
    const out = renderImports([
      { moduleSpecifier: 'z', symbol: 'z1' },
      { moduleSpecifier: 'a', symbol: 'a1' },
      { moduleSpecifier: 'm', symbol: 'm1' },
    ]);
    expect(out).toBe(
      ["import { a1 } from 'a';", "import { m1 } from 'm';", "import { z1 } from 'z';"].join('\n'),
    );
  });

  it('orders modules, default bindings and attributes by code unit, whatever the locale', () => {
    const out = renderImports([
      { moduleSpecifier: '@acme/alpha', symbol: 'a' },
      { moduleSpecifier: '@acme/Beta', symbol: 'b' },
      { moduleSpecifier: 'm', symbol: 'alpha', kind: 'default' },
      { moduleSpecifier: 'm', symbol: 'Beta', kind: 'default' },
      { moduleSpecifier: 'j', symbol: 'j', attributes: { mode: 'x', Type: 'json' } },
    ]);
    expect(out).toBe(
      [
        "import { b } from '@acme/Beta';",
        "import { a } from '@acme/alpha';",
        'import { j } from \'j\' with { Type: "json", mode: "x" };',
        "import Beta from 'm';",
        "import alpha from 'm';",
      ].join('\n'),
    );
  });

  it('emits a default import when kind is "default"', () => {
    const out = renderImports([
      { moduleSpecifier: './contract.json', symbol: 'contract', kind: 'default' },
    ]);
    expect(out).toBe("import contract from './contract.json';");
  });

  it('renders import attributes verbatim in a `with` clause', () => {
    const out = renderImports([
      {
        moduleSpecifier: './contract.json',
        symbol: 'contract',
        kind: 'default',
        attributes: { type: 'json' },
      },
    ]);
    expect(out).toBe('import contract from \'./contract.json\' with { type: "json" };');
  });

  it('combines a default with named imports on the same module into one line', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'a' },
      { moduleSpecifier: 'm', symbol: 'def', kind: 'default' },
      { moduleSpecifier: 'm', symbol: 'b' },
    ]);
    expect(out).toBe("import def, { a, b } from 'm';");
  });

  it('renders two distinct default symbols on the same module as separate lines', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'x', kind: 'default' },
      { moduleSpecifier: 'm', symbol: 'y', kind: 'default' },
    ]);
    expect(out).toBe(["import x from 'm';", "import y from 'm';"].join('\n'));
  });

  it('sorts multiple distinct default symbols alphabetically', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'z', kind: 'default' },
      { moduleSpecifier: 'm', symbol: 'a', kind: 'default' },
    ]);
    expect(out).toBe(["import a from 'm';", "import z from 'm';"].join('\n'));
  });

  it('attaches a shared attributes clause to every distinct default line', () => {
    const out = renderImports([
      {
        moduleSpecifier: './c.json',
        symbol: 'endContract',
        kind: 'default',
        attributes: { type: 'json' },
      },
      {
        moduleSpecifier: './c.json',
        symbol: 'startContract',
        kind: 'default',
        attributes: { type: 'json' },
      },
    ]);
    expect(out).toBe(
      [
        'import endContract from \'./c.json\' with { type: "json" };',
        'import startContract from \'./c.json\' with { type: "json" };',
      ].join('\n'),
    );
  });

  it('renders multiple distinct defaults plus a named-only line when both are present', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'x', kind: 'default' },
      { moduleSpecifier: 'm', symbol: 'y', kind: 'default' },
      { moduleSpecifier: 'm', symbol: 'a' },
    ]);
    expect(out).toBe(
      ["import x from 'm';", "import y from 'm';", "import { a } from 'm';"].join('\n'),
    );
  });

  it('permits repeated default requirements with the same symbol', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'x', kind: 'default' },
      { moduleSpecifier: 'm', symbol: 'x', kind: 'default' },
    ]);
    expect(out).toBe("import x from 'm';");
  });

  it('throws CONTRACT.PACK_CONTRIBUTION_INVALID when two requirements for the same module disagree on attributes', () => {
    let thrown: unknown;
    try {
      renderImports([
        {
          moduleSpecifier: 'm',
          symbol: 'a',
          attributes: { type: 'json' },
        },
        {
          moduleSpecifier: 'm',
          symbol: 'b',
          attributes: { type: 'text' },
        },
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(isStructuredError(thrown)).toBe(true);
    expect(thrown).toMatchObject({ code: 'CONTRACT.PACK_CONTRIBUTION_INVALID' });
    expect((thrown as Error).message).toMatch(/Conflicting import attributes/);
  });

  it('treats a missing attributes map as distinct from an empty one for conflict purposes', () => {
    expect(() =>
      renderImports([
        { moduleSpecifier: 'm', symbol: 'a', attributes: { type: 'json' } },
        { moduleSpecifier: 'm', symbol: 'b' },
      ]),
    ).toThrow(/Conflicting import attributes/);
  });

  it('merges duplicate (module, symbol) pairs across attribute-agreeing requirements', () => {
    const out = renderImports([
      { moduleSpecifier: './c.json', symbol: 'c', kind: 'default', attributes: { type: 'json' } },
      { moduleSpecifier: './c.json', symbol: 'c', kind: 'default', attributes: { type: 'json' } },
    ]);
    expect(out).toBe('import c from \'./c.json\' with { type: "json" };');
  });

  it('sorts multi-key attribute entries deterministically in the `with` clause', () => {
    const out = renderImports([
      {
        moduleSpecifier: './c.json',
        symbol: 'c',
        kind: 'default',
        attributes: { type: 'json', integrity: 'sha256-abc' },
      },
    ]);
    expect(out).toBe('import c from \'./c.json\' with { integrity: "sha256-abc", type: "json" };');
  });

  it('detects attribute conflicts when keys differ at the same length', () => {
    expect(() =>
      renderImports([
        { moduleSpecifier: 'm', symbol: 'a', attributes: { type: 'json' } },
        { moduleSpecifier: 'm', symbol: 'b', attributes: { kind: 'json' } },
      ]),
    ).toThrow(/Conflicting import attributes/);
  });

  it('detects attribute conflicts when attribute maps have different sizes', () => {
    expect(() =>
      renderImports([
        {
          moduleSpecifier: 'm',
          symbol: 'a',
          attributes: { type: 'json', integrity: 'sha256-abc' },
        },
        { moduleSpecifier: 'm', symbol: 'b', attributes: { type: 'json' } },
      ]),
    ).toThrow(/Conflicting import attributes/);
  });

  it('omits the `with` clause when attributes is an empty object', () => {
    const out = renderImports([{ moduleSpecifier: 'm', symbol: 'a', attributes: {} }]);
    expect(out).toBe("import { a } from 'm';");
  });

  it('renders an aliased named import', () => {
    const out = renderImports([{ moduleSpecifier: 'm', symbol: 'A', alias: 'B' }]);
    expect(out).toBe("import { A as B } from 'm';");
  });

  it('omits the alias clause when alias equals the symbol', () => {
    const out = renderImports([{ moduleSpecifier: 'm', symbol: 'A', alias: 'A' }]);
    expect(out).toBe("import { A } from 'm';");
  });

  it('emits `import type` when every symbol from a module is type-only', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'B', typeOnly: true, alias: 'C' },
      { moduleSpecifier: 'm', symbol: 'A', typeOnly: true },
    ]);
    expect(out).toBe("import type { A, B as C } from 'm';");
  });

  it('prefixes individual type-only specifiers when a module mixes value and type imports', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'val' },
      { moduleSpecifier: 'm', symbol: 'T', typeOnly: true },
    ]);
    expect(out).toBe("import { type T, val } from 'm';");
  });

  it('keeps both bare and aliased imports of the same symbol', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'A' },
      { moduleSpecifier: 'm', symbol: 'A', alias: 'B' },
    ]);
    expect(out).toBe("import { A, A as B } from 'm';");
  });

  it('keeps two distinct aliases of the same symbol', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'A', alias: 'B' },
      { moduleSpecifier: 'm', symbol: 'A', alias: 'C' },
    ]);
    expect(out).toBe("import { A as B, A as C } from 'm';");
  });

  it('deduplicates identical (symbol, alias) pairs', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'A', alias: 'B' },
      { moduleSpecifier: 'm', symbol: 'A', alias: 'B' },
    ]);
    expect(out).toBe("import { A as B } from 'm';");
  });

  it('merges typeOnly by AND for identical (symbol, alias) pairs', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'A', alias: 'B', typeOnly: true },
      { moduleSpecifier: 'm', symbol: 'A', alias: 'B' },
    ]);
    expect(out).toBe("import { A as B } from 'm';");
  });

  it('orders bare and aliased forms of the same symbol with the bare form first', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'A', alias: 'Z' },
      { moduleSpecifier: 'm', symbol: 'A', alias: 'A2' },
      { moduleSpecifier: 'm', symbol: 'A' },
    ]);
    expect(out).toBe("import { A, A as A2, A as Z } from 'm';");
  });

  it('splits a type-only statement with default and named into two import lines', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'D', kind: 'default', typeOnly: true },
      { moduleSpecifier: 'm', symbol: 'N', typeOnly: true },
    ]);
    expect(out).toBe(["import type D from 'm';", "import type { N } from 'm';"].join('\n'));
  });

  it('splits a type-only statement with default and multiple named imports', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'D', kind: 'default', typeOnly: true },
      { moduleSpecifier: 'm', symbol: 'A', typeOnly: true },
      { moduleSpecifier: 'm', symbol: 'B', typeOnly: true, alias: 'C' },
    ]);
    expect(out).toBe(["import type D from 'm';", "import type { A, B as C } from 'm';"].join('\n'));
  });

  it('keeps the non-type-only mixed default+named form on a single line', () => {
    const out = renderImports([
      { moduleSpecifier: 'm', symbol: 'D', kind: 'default' },
      { moduleSpecifier: 'm', symbol: 'T', typeOnly: true },
      { moduleSpecifier: 'm', symbol: 'v' },
    ]);
    expect(out).toBe("import D, { type T, v } from 'm';");
  });

  it('renders end/start contract imports colliding on the same specifiers (from === to)', () => {
    const out = renderImports([
      {
        moduleSpecifier: './snapshots/abc/contract.json',
        symbol: 'endContract',
        kind: 'default',
        attributes: { type: 'json' },
      },
      {
        moduleSpecifier: './snapshots/abc/contract',
        symbol: 'Contract',
        alias: 'End',
        typeOnly: true,
      },
      {
        moduleSpecifier: './snapshots/abc/contract.json',
        symbol: 'startContract',
        kind: 'default',
        attributes: { type: 'json' },
      },
      {
        moduleSpecifier: './snapshots/abc/contract',
        symbol: 'Contract',
        alias: 'Start',
        typeOnly: true,
      },
    ]);
    expect(out).toBe(
      [
        "import type { Contract as End, Contract as Start } from './snapshots/abc/contract';",
        'import endContract from \'./snapshots/abc/contract.json\' with { type: "json" };',
        'import startContract from \'./snapshots/abc/contract.json\' with { type: "json" };',
      ].join('\n'),
    );
  });

  it('stringifies multi-key attribute maps in sorted order in the conflict message', () => {
    try {
      renderImports([
        {
          moduleSpecifier: 'm',
          symbol: 'a',
          attributes: { type: 'json', integrity: 'sha256-abc' },
        },
        {
          moduleSpecifier: 'm',
          symbol: 'b',
          attributes: { type: 'text', integrity: 'sha256-xyz' },
        },
      ]);
      throw new Error('expected renderImports to throw');
    } catch (err) {
      expect((err as Error).message).toContain(
        '{ integrity: "sha256-abc", type: "json" } vs { integrity: "sha256-xyz", type: "text" }',
      );
    }
  });
});
