import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkFile,
  collectAnchors,
  extractLinks,
  formatProblem,
  isExcluded,
  slugify,
} from './check-doc-links.mjs';

function fakeRepo(files) {
  const directories = new Set();
  for (const path of Object.keys(files)) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  return {
    exists: (path) => path in files || directories.has(path),
    isFile: (path) => path in files,
    readFile: (path) => files[path],
  };
}

function check(files, file = 'docs/index.md') {
  return checkFile(file, files[file], fakeRepo(files)).map(formatProblem);
}

describe('checkFile', () => {
  it('accepts a link to an existing file', () => {
    deepStrictEqual(
      check({ 'docs/index.md': 'See [guide](guide.md).', 'docs/guide.md': '# Guide' }),
      [],
    );
  });

  it('reports a link to a missing file', () => {
    deepStrictEqual(check({ 'docs/index.md': 'Intro\n\nSee [guide](missing.md).' }), [
      'docs/index.md:3: missing.md (file not found)',
    ]);
  });

  it('accepts an anchor that matches a heading', () => {
    const files = {
      'docs/index.md': '[x](guide.md#getting-started)',
      'docs/guide.md': '## Getting started!',
    };
    deepStrictEqual(check(files), []);
  });

  it('reports an anchor that matches no heading', () => {
    const files = { 'docs/index.md': '[x](guide.md#setup)', 'docs/guide.md': '## Getting started' };
    deepStrictEqual(check(files), ['docs/index.md:1: guide.md#setup (no heading #setup)']);
  });

  it('decodes percent-encoded paths', () => {
    const files = {
      'docs/index.md': '[adr](adrs/ADR%201%20-%20Thing.md)',
      'docs/adrs/ADR 1 - Thing.md': '# ADR 1',
    };
    deepStrictEqual(check(files), []);
  });

  it('checks a bare anchor against the same file', () => {
    const files = { 'docs/index.md': '# Index\n\n## Usage\n\n[up](#usage) [gone](#install)' };
    deepStrictEqual(check(files), ['docs/index.md:5: #install (no heading #install)']);
  });

  it('accepts an explicit html anchor', () => {
    const files = { 'docs/index.md': '<a id="custom-spot"></a>\n\n[here](#custom-spot)' };
    deepStrictEqual(check(files), []);
  });

  it('accepts a link to a directory', () => {
    deepStrictEqual(check({ 'docs/index.md': '[adrs](adrs/)', 'docs/adrs/one.md': '# One' }), []);
  });

  it('skips absolute urls', () => {
    deepStrictEqual(
      check({ 'docs/index.md': '[a](https://x.dev/a.md) [b](mailto:a@b.c) [c](http://x)' }),
      [],
    );
  });

  it('skips targets that are not file paths', () => {
    deepStrictEqual(check({ 'docs/index.md': '[a](...) [b]({{schemaPath}})' }), []);
  });

  it('resolves a leading slash from the repository root', () => {
    deepStrictEqual(check({ 'docs/index.md': '[r](/README.md)', 'README.md': '# Root' }), []);
  });
});

describe('extractLinks', () => {
  it('ignores links inside a fenced code block', () => {
    deepStrictEqual(extractLinks('```md\n[a](missing.md)\n```\n[b](real.md)'), [
      { target: 'real.md', line: 4 },
    ]);
  });

  it('ignores links inside inline code', () => {
    deepStrictEqual(extractLinks('Write `[a](missing.md)` then [b](real.md).'), [
      { target: 'real.md', line: 1 },
    ]);
  });

  it('keeps a link whose text is inline code', () => {
    deepStrictEqual(extractLinks('[`real.md`](real.md)'), [{ target: 'real.md', line: 1 }]);
  });

  it('reads a target in angle brackets', () => {
    deepStrictEqual(extractLinks('[a](<docs/a b.md> "title")'), [
      { target: 'docs/a b.md', line: 1 },
    ]);
  });

  it('skips front matter', () => {
    deepStrictEqual(extractLinks('---\nx: "[a](missing.md)"\n---\n[b](real.md)'), [
      { target: 'real.md', line: 4 },
    ]);
  });
});

describe('collectAnchors', () => {
  it('numbers duplicate headings', () => {
    deepStrictEqual(
      [...collectAnchors('## Example\n\n## Example\n\n## Example')],
      ['example', 'example-1', 'example-2'],
    );
  });

  it('ignores headings inside a code fence', () => {
    deepStrictEqual([...collectAnchors('```\n# not a heading\n```\n# Real')], ['real']);
  });

  it('reads setext headings', () => {
    deepStrictEqual([...collectAnchors('Title\n=====\n\nPart\n----')], ['title', 'part']);
  });
});

describe('slugify', () => {
  it('drops punctuation and keeps hyphens and underscores', () => {
    strictEqual(slugify('ADR 12 — Why `foo_bar` (v2)?'), 'adr-12--why-foo_bar-v2');
  });

  it('uses link text and drops emphasis', () => {
    strictEqual(slugify('**Bold** and [link](x.md) _here_'), 'bold-and-link-here');
  });
});

describe('isExcluded', () => {
  it('excludes historical records and project folders', () => {
    deepStrictEqual(
      [
        'docs/releases/v1.md',
        'CHANGELOG.md',
        'skills/prisma-8/upgrading/app/upgrades/a-to-b/instructions.md',
        'upgrade-instructions/releases/a-to-b/sources/x/app/instructions.md',
        'projects/foo/spec.md',
        'packages/3-targets/postgres/9-facade/src/init/init-readme.md',
        'skills-contrib/product-direction/assets/vision.md',
      ].map(isExcluded),
      [true, true, true, true, true, true, true],
    );
  });

  it('includes everything else', () => {
    deepStrictEqual(
      ['projects/README.md', 'docs/README.md', 'skills/prisma-8/upgrading/app/SKILL.md'].map(
        isExcluded,
      ),
      [false, false, false],
    );
  });
});
