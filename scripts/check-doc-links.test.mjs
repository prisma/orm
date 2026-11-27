import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkFile,
  checkRepository,
  collectAnchors,
  extractLinks,
  formatProblem,
  isExcluded,
  slugify,
} from './check-doc-links.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-doc-links.mjs');

function fakeRepo(files) {
  const directories = new Set();
  for (const path of Object.keys(files)) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  return {
    exists: (path) => path === '' || path in files || directories.has(path),
    isFile: (path) => path in files,
    readFile: (path) => files[path],
  };
}

function check(files, file = 'docs/index.md') {
  return checkFile(file, files[file], fakeRepo(files)).map(formatProblem);
}

function targets(content) {
  return extractLinks(content).map((link) => link.target);
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

  it('reports a link that leaves the repository', () => {
    deepStrictEqual(check({ 'docs/index.md': '[up](../../outside.md)' }), [
      'docs/index.md:1: ../../outside.md (points outside the repository)',
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

  it('accepts an anchor written in upper case', () => {
    const files = {
      'docs/index.md': '[x](guide.md#Getting-Started)',
      'docs/guide.md': '## Getting started',
    };
    deepStrictEqual(check(files), []);
  });

  it('decodes percent-encoded paths', () => {
    const files = {
      'docs/index.md': '[adr](adrs/ADR%201%20-%20Thing.md)',
      'docs/adrs/ADR 1 - Thing.md': '# ADR 1',
    };
    deepStrictEqual(check(files), []);
  });

  it('ignores a query string when it looks for the file', () => {
    deepStrictEqual(
      check({ 'docs/index.md': '[g](guide.md?raw=true)', 'docs/guide.md': '# Guide' }),
      [],
    );
  });

  it('does not treat a line anchor in a plain view as a heading', () => {
    deepStrictEqual(
      check({ 'docs/index.md': '[g](guide.md?plain=1#L5)', 'docs/guide.md': '# Guide' }),
      [],
    );
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

  it('does not look for a heading in a directory whose name ends in .md', () => {
    deepStrictEqual(
      check({ 'docs/index.md': '[d](notes.md#top)', 'docs/notes.md/one.txt': 'x' }),
      [],
    );
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

  it("checks a link to this repository's default branch on GitHub", () => {
    const files = {
      'docs/index.md': [
        '[a](https://github.com/prisma/orm/blob/main/README.md#root)',
        '[b](https://github.com/prisma/orm/tree/main/docs)',
        '[c](https://github.com/prisma/orm/blob/main/gone.md)',
        '[d](https://github.com/prisma/orm/blob/main/README.md#nope)',
      ].join('\n'),
      'README.md': '# Root',
    };
    deepStrictEqual(check(files), [
      'docs/index.md:3: https://github.com/prisma/orm/blob/main/gone.md (file not found)',
      'docs/index.md:4: https://github.com/prisma/orm/blob/main/README.md#nope (no heading #nope)',
    ]);
  });

  it('skips a GitHub link pinned to a tag, a commit or another branch', () => {
    const files = {
      'docs/index.md':
        '[a](https://github.com/prisma/orm/blob/v1.0.0/gone.md) [b](https://github.com/prisma/orm/blob/abc123/gone.md) [c](https://github.com/prisma/orm/blob/main-v7/gone.md)',
    };
    deepStrictEqual(check(files), []);
  });

  it('checks a reference definition', () => {
    deepStrictEqual(check({ 'docs/index.md': 'See [guide][g].\n\n[g]: missing.md "Guide"' }), [
      'docs/index.md:3: missing.md (file not found)',
    ]);
  });
});

describe('extractLinks', () => {
  it('ignores links inside a fenced code block', () => {
    deepStrictEqual(extractLinks('```md\n[a](missing.md)\n```\n[b](real.md)'), [
      { target: 'real.md', line: 4 },
    ]);
  });

  it('does not let a shorter fence close a longer one', () => {
    deepStrictEqual(targets('````\n```\n[a](inside.md)\n````\n[b](real.md)'), ['real.md']);
  });

  it('ignores links inside a fenced code block in a blockquote', () => {
    deepStrictEqual(targets('> ```\n> [a](inside.md)\n> ```\n\n[b](real.md)'), ['real.md']);
  });

  it('ignores links inside an indented code block', () => {
    deepStrictEqual(targets('Text\n\n    [a](inside.md)\n\n[b](real.md)'), ['real.md']);
  });

  it('ignores a fence indented inside a list item', () => {
    deepStrictEqual(
      targets('- item\n\n      ```\n      [a](inside.md)\n      ```\n\n[b](real.md)'),
      ['real.md'],
    );
  });

  it('reads a link indented as a list continuation', () => {
    deepStrictEqual(targets('- item\n\n    [a](real.md)'), ['real.md']);
  });

  it('ignores links inside inline code', () => {
    deepStrictEqual(extractLinks('Write `[a](missing.md)` then [b](real.md).'), [
      { target: 'real.md', line: 1 },
    ]);
  });

  it('ignores an escaped bracket', () => {
    deepStrictEqual(targets('\\[x](y.md) and [b](real.md)'), ['real.md']);
  });

  it('ignores links inside an html comment', () => {
    deepStrictEqual(targets('<!-- [a](gone.md) -->\n[b](real.md)'), ['real.md']);
  });

  it('keeps a link whose text is inline code', () => {
    deepStrictEqual(extractLinks('[`real.md`](real.md)'), [{ target: 'real.md', line: 1 }]);
  });

  it('reads a target in angle brackets', () => {
    deepStrictEqual(extractLinks('[a](<docs/a b.md> "title")'), [
      { target: 'docs/a b.md', line: 1 },
    ]);
  });

  it('reads a title in parentheses', () => {
    deepStrictEqual(targets('[x](real.md (title))'), ['real.md']);
  });

  it('reads a path with balanced parentheses', () => {
    deepStrictEqual(targets('[x](foo(bar).md)'), ['foo(bar).md']);
  });

  it('reads link text that wraps onto the next line', () => {
    deepStrictEqual(extractLinks('Intro [some\ntext](real.md).'), [{ target: 'real.md', line: 1 }]);
  });

  it('reads link text that contains brackets', () => {
    deepStrictEqual(targets('[a [b] c](real.md)'), ['real.md']);
  });

  it('reads an image inside a link', () => {
    deepStrictEqual(targets('[![badge](badge.png)](real.md)'), ['real.md', 'badge.png']);
  });

  it('reads html href and src attributes', () => {
    deepStrictEqual(extractLinks('<a href="real.md">x</a>\n<img alt="" src="logo.png">'), [
      { target: 'real.md', line: 1 },
      { target: 'logo.png', line: 2 },
    ]);
  });

  it('reads a line that looks like a definition inside a paragraph as text', () => {
    deepStrictEqual(targets('The fields are:\n[name]: the user name'), []);
  });

  it('unescapes a reference definition destination', () => {
    deepStrictEqual(targets('[g][g]\n\n[g]: foo\\(bar\\).md'), ['foo(bar).md']);
  });

  it('ignores links inside an html comment that spans blank lines', () => {
    deepStrictEqual(targets('<!--\n\n[a](gone.md)\n\n-->\n[b](real.md)'), ['real.md']);
  });

  it('reads a reference definition inside a blockquote', () => {
    deepStrictEqual(extractLinks('> [r]: missing.md'), [{ target: 'missing.md', line: 1 }]);
  });

  it('does not join link text across blocks', () => {
    deepStrictEqual(
      [
        '- [first\n- second](a.md)',
        '## [Heading\ntext](b.md)',
        '[before\n```\ncode\n```\nafter](c.md)',
        'Text\n\n    code [x\n\nnext](d.md)',
      ].flatMap(targets),
      [],
    );
  });

  it('reads reference definitions and not footnotes', () => {
    deepStrictEqual(extractLinks('[a][g]\n\n[g]: <a b.md>\n[^1]: A footnote.'), [
      { target: 'a b.md', line: 3 },
    ]);
  });

  it('skips front matter', () => {
    deepStrictEqual(extractLinks('---\nx: "[a](missing.md)"\n---\n[b](real.md)'), [
      { target: 'real.md', line: 4 },
    ]);
  });

  it('counts lines in a file with Windows line endings', () => {
    deepStrictEqual(extractLinks('---\r\nx: "[a](missing.md)"\r\n---\r\n\r\n[b](real.md)'), [
      { target: 'real.md', line: 5 },
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

  it('skips a number a literal heading already uses', () => {
    deepStrictEqual([...collectAnchors('## a\n\n## a\n\n## a-1')], ['a', 'a-1', 'a-1-1']);
  });

  it('keeps counting past a number a literal heading already uses', () => {
    deepStrictEqual(
      [...collectAnchors('## a\n\n## a-1\n\n## a\n\n## a')],
      ['a', 'a-1', 'a-2', 'a-3'],
    );
  });

  it('ignores headings inside a code fence', () => {
    deepStrictEqual([...collectAnchors('```\n# not a heading\n```\n# Real')], ['real']);
  });

  it('reads setext headings', () => {
    deepStrictEqual([...collectAnchors('Title\n=====\n\nPart\n----')], ['title', 'part']);
  });

  it('drops the closing hashes of a heading', () => {
    deepStrictEqual([...collectAnchors('## Usage ##')], ['usage']);
  });

  it('reads the rest of the file after an unclosed comment in the middle of a line', () => {
    const content = 'The <!-- marker opens a comment.\n\n## After\n\n[a](a.md)';
    deepStrictEqual([targets(content), [...collectAnchors(content)]], [['a.md'], ['after']]);
  });

  it('does not carry a comment that opens mid-line past the end of its paragraph', () => {
    deepStrictEqual(targets('Text <!-- open\n\n--> [a](a.md)'), ['a.md']);
  });

  it('ends a comment at the first closing marker, backticks or not', () => {
    deepStrictEqual(
      targets('<!-- a ` b --> c `\n\n[x](x.md)\n\n<!--\na ` b --> c `\n\n[y](y.md)'),
      ['x.md', 'y.md'],
    );
  });

  it('ends a fence opened in a blockquote with the blockquote', () => {
    const content = '> ```\n> code\n\nAfter [a](a.md)\n\n## After';
    deepStrictEqual([targets(content), [...collectAnchors(content)]], [['a.md'], ['after']]);
    deepStrictEqual(targets('> ```\n> [h](h.md)\n> ```\n> after [b](b.md)'), ['b.md']);
  });

  it('ends a comment opened in a blockquote with the blockquote', () => {
    const content = '> <!-- note\n\n## After\n\n[a](a.md)';
    deepStrictEqual([targets(content), [...collectAnchors(content)]], [['a.md'], ['after']]);
  });

  it('ends a fence opened in a nested blockquote at a shallower line', () => {
    deepStrictEqual(
      [
        '> > ```\n> > example\n> [broken](missing.md)',
        '>> ```\n>> [h](h.md)\n>> ```\n>> after [b](b.md)',
        '> ```\n> > [deeper](deeper.md)\n> ```\n[c](c.md)',
      ].map(targets),
      [['missing.md'], ['b.md'], ['c.md']],
    );
  });

  it('ends a comment opened in a nested blockquote at a shallower line', () => {
    deepStrictEqual(
      ['> > <!-- a\n> [y](y.md)', '> <!-- a\n> > [deeper](deeper.md)\n> -->\n[z](z.md)'].map(targets),
      [['y.md'], ['z.md']],
    );
  });

  it('reads a definition in a blockquote after a quoted blank line', () => {
    deepStrictEqual(targets('> [x][r]\n>\n> [r]: missing.md'), ['missing.md']);
  });

  it('does not open a fence on a line with more backticks', () => {
    deepStrictEqual(targets('```js``` inline\n\n> ```x``` y\n\n[a](a.md)'), ['a.md']);
  });

  it('ignores comment markers inside inline code', () => {
    deepStrictEqual(
      targets('Write `<!--` to open.\n\n[b](real.md)\n\nUse `<!--` [c](c.md) `-->`.'),
      ['real.md', 'c.md'],
    );
  });

  it('ignores anchors and headings inside html comments', () => {
    deepStrictEqual(
      [...collectAnchors('<!-- <a id="hidden"></a> -->\n\n<!--\n## Hidden\n-->\n\n## Real')],
      ['real'],
    );
  });

  it('reads a heading inside a blockquote', () => {
    deepStrictEqual([...collectAnchors('> ## Quoted heading')], ['quoted-heading']);
  });
});

describe('slugify', () => {
  it('drops punctuation and keeps hyphens and underscores', () => {
    strictEqual(slugify('ADR 12 — Why `foo_bar` (v2)?'), 'adr-12--why-foo_bar-v2');
  });

  it('uses link text and drops emphasis', () => {
    strictEqual(slugify('**Bold** and [link](x.md) _here_'), 'bold-and-link-here');
  });

  it('keeps markup inside inline code', () => {
    deepStrictEqual(
      [slugify('The `__init__` method'), slugify('Use `Array<T>`')],
      ['the-__init__-method', 'use-arrayt'],
    );
  });

  it('keeps the hyphen left by punctuation at the start', () => {
    strictEqual(slugify('`*` wildcard'), '-wildcard');
  });

  it('decodes html entities', () => {
    strictEqual(slugify('a &amp; b'), 'a--b');
  });
});

describe('isExcluded', () => {
  it('excludes project folders and templates', () => {
    deepStrictEqual(
      [
        'projects/foo/spec.md',
        'packages/3-targets/postgres/9-facade/src/init/init-readme.md',
        'skills-contrib/product-direction/assets/vision.md',
      ].map(isExcluded),
      [true, true, true],
    );
  });

  it('includes everything else', () => {
    deepStrictEqual(
      [
        'projects/README.md',
        'docs/README.md',
        'skills/prisma-8/upgrading/app/SKILL.md',
        'skills/prisma-8/upgrading/app/upgrades/a-to-b/instructions.md',
        'docs/releases/v1.md',
        'CHANGELOG.md',
        'upgrade-instructions/releases/a-to-b/sources/x/app/instructions.md',
      ].map(isExcluded),
      [false, false, false, false, false, false, false],
    );
  });
});

const scratch = mkdtempSync(join(tmpdir(), 'check-doc-links-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

function gitRepo(name, files) {
  const root = join(scratch, name);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

function git(root, ...args) {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
}

describe('checkRepository', () => {
  it('scans and resolves tracked and new files, never ignored ones', () => {
    const root = gitRepo('listing', {
      '.gitignore': 'ignored/\n',
      'tracked.md': '[a](new.md) [b](ignored/rule.md) [c](deleted.md) [d](ignored/)',
      'new.md': '[e](gone.md)',
      'deleted.md': '# Deleted',
      'ignored/rule.md': '[f](gone.md)',
      'projects/p/spec.md': '[g](gone.md)',
    });
    git(root, 'add', '.gitignore', 'tracked.md', 'deleted.md', 'projects/p/spec.md');
    unlinkSync(join(root, 'deleted.md'));
    deepStrictEqual(checkRepository(root).map(formatProblem).sort(), [
      'new.md:1: gone.md (file not found)',
      'tracked.md:1: deleted.md (file not found)',
      'tracked.md:1: ignored/ (file not found)',
      'tracked.md:1: ignored/rule.md (file not found)',
    ]);
  });

  it('reports a broken link once when two paths are the same file', () => {
    const root = gitRepo('symlink', { 'AGENTS.md': '[a](gone.md)' });
    symlinkSync('AGENTS.md', join(root, 'CLAUDE.md'));
    deepStrictEqual(checkRepository(root).map(formatProblem), [
      'AGENTS.md:1: gone.md (file not found)',
    ]);
  });
});

describe('running the script', () => {
  function scriptRepo(name) {
    const root = gitRepo(name, { 'a.md': '[x](missing.md)' });
    mkdirSync(join(root, 'scripts'));
    copyFileSync(SCRIPT, join(root, 'scripts/check-doc-links.mjs'));
    return root;
  }

  it('exits 1 and prints the broken link', () => {
    const root = scriptRepo('plain');
    const result = spawnSync(process.execPath, [join(root, 'scripts/check-doc-links.mjs')], {
      encoding: 'utf8',
    });
    deepStrictEqual(
      [result.status, result.stderr.split('\n')[0]],
      [1, 'a.md:1: missing.md (file not found)'],
    );
  });

  it('runs from a path with a space', () => {
    const root = scriptRepo('with space');
    const result = spawnSync(process.execPath, [join(root, 'scripts/check-doc-links.mjs')], {
      encoding: 'utf8',
    });
    strictEqual(result.status, 1);
  });

  it('runs through a symlink', () => {
    const root = scriptRepo('target');
    symlinkSync(root, join(scratch, 'link'));
    const result = spawnSync(
      process.execPath,
      [join(scratch, 'link/scripts/check-doc-links.mjs')],
      {
        encoding: 'utf8',
      },
    );
    strictEqual(result.status, 1);
  });

  it('exits 0 when every link resolves', () => {
    const root = gitRepo('clean', { 'a.md': '[x](b.md)', 'b.md': '# B' });
    mkdirSync(join(root, 'scripts'));
    copyFileSync(SCRIPT, join(root, 'scripts/check-doc-links.mjs'));
    strictEqual(spawnSync(process.execPath, [join(root, 'scripts/check-doc-links.mjs')]).status, 0);
  });
});
