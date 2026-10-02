import { strictEqual } from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { printTaggedLiteral } from '../../packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts';
import { printSqlLiteral, rewriteSqlStrings } from './rewrite-sql-strings.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repositoryRoot = join(here, '..', '..');

describe('rewriteSqlStrings', () => {
  it('rewrites the where and expression arguments of @@index', () => {
    const before = [
      'model Post {',
      '  id    Int    @id',
      '  title String',
      '  @@index([title], where: "archived_at IS NULL", name: "active")',
      '  @@index(expression: "lower(title)", name: "title_lower")',
      '}',
    ].join('\n');
    strictEqual(
      rewriteSqlStrings(before),
      [
        'model Post {',
        '  id    Int    @id',
        '  title String',
        '  @@index([title], where: sql`archived_at IS NULL`, name: "active")',
        '  @@index(expression: sql`lower(title)`, name: "title_lower")',
        '}',
      ].join('\n'),
    );
  });

  it('keeps treating // comments as comments after an unclosed backtick', () => {
    const before = [
      '  @@index([a], where: sql`open',
      '  // where: "commented out"',
      '  @@check(expression: "total > 0", name: "positive")',
    ].join('\n');
    strictEqual(
      rewriteSqlStrings(before),
      [
        '  @@index([a], where: sql`open',
        '  // where: "commented out"',
        '  @@check(expression: sql`total > 0`, name: "positive")',
      ].join('\n'),
    );
  });

  it('rewrites @@fullTextIndex(where:) and @@check(expression:), in single quotes too', () => {
    const before = [
      '  @@fullTextIndex([body], where: \'post_id = 1\', name: "body_search")',
      '  @@check(expression: "total > 0", name: "positive")',
    ].join('\n');
    strictEqual(
      rewriteSqlStrings(before),
      [
        '  @@fullTextIndex([body], where: sql`post_id = 1`, name: "body_search")',
        '  @@check(expression: sql`total > 0`, name: "positive")',
      ].join('\n'),
    );
  });

  it('rewrites using and withCheck in a policy block, decoding escaped quotes', () => {
    const before = [
      'policy_update owner_write {',
      '  target    = Profile',
      '  using     = "\\"userId\\"::uuid = auth.uid()"',
      '  withCheck = "\\"userId\\"::uuid = auth.uid()"',
      '}',
    ].join('\n');
    strictEqual(
      rewriteSqlStrings(before),
      [
        'policy_update owner_write {',
        '  target    = Profile',
        '  using     = sql`"userId"::uuid = auth.uid()`',
        '  withCheck = sql`"userId"::uuid = auth.uid()`',
        '}',
      ].join('\n'),
    );
  });

  it('writes a text holding a backtick in the double-quote form', () => {
    strictEqual(
      rewriteSqlStrings('  @@check(expression: "a <> \'`\'", name: "c")'),
      '  @@check(expression: sql"a <> \'`\'", name: "c")',
    );
  });

  it('doubles a backslash in the backtick form', () => {
    strictEqual(
      rewriteSqlStrings('  @@check(expression: "a ~ \'\\\\d\'", name: "c")'),
      '  @@check(expression: sql`a ~ \'\\\\d\'`, name: "c")',
    );
  });

  it('leaves other arguments, other attributes and sql literals alone', () => {
    const source = [
      'model Post {',
      '  id Int @id @default(sql`gen_random_uuid()`)',
      '  @@index([id], name: "where: \\"x\\"", type: "gin")',
      '  @@map("posts")',
      '  @@check(expression: sql`id > 0`, name: "positive")',
      '}',
      'policy_select read {',
      '  target = Post',
      '  using  = sql`true`',
      '}',
    ].join('\n');
    strictEqual(rewriteSqlStrings(source), source);
  });
});

describe('rewriteSqlStrings and existing literals', () => {
  it('leaves an attribute written inside a sql literal alone', () => {
    const source = [
      'model Post {',
      '  id Int @id',
      '  @@check(expression: sql`note <> \'@@check(expression: "x", name: "c")\'`, name: "n")',
      '}',
    ].join('\n');
    strictEqual(rewriteSqlStrings(source), source);
  });

  it('leaves an attribute written inside a quoted string alone', () => {
    const source = '  @@map("@@index([a], where: \'x\')")';
    strictEqual(rewriteSqlStrings(source), source);
  });

  it('leaves a policy block written inside a sql literal alone', () => {
    const source = [
      'policy_select read {',
      '  target = Post',
      '  using  = sql`',
      'policy_select inner {',
      '  using = "x"',
      '}',
      '`',
      '}',
    ].join('\n');
    strictEqual(rewriteSqlStrings(source), source);
  });
});

describe('rewriteSqlStrings and comments', () => {
  it('rewrites a policy after an apostrophe in a comment inside the block', () => {
    const before = [
      'policy_select p {',
      '  target = Post',
      "  // owner's rows",
      '  using = "owner_id = 1"',
      '}',
    ].join('\n');
    strictEqual(
      rewriteSqlStrings(before),
      [
        'policy_select p {',
        '  target = Post',
        "  // owner's rows",
        '  using = sql`owner_id = 1`',
        '}',
      ].join('\n'),
    );
  });

  it('rewrites an attribute after an apostrophe in a comment inside its arguments', () => {
    const before = [
      '  @@index(',
      "    // the owner's active rows",
      '    [ownerId],',
      '    where: "archived_at IS NULL",',
      '  )',
    ].join('\n');
    strictEqual(
      rewriteSqlStrings(before),
      [
        '  @@index(',
        "    // the owner's active rows",
        '    [ownerId],',
        '    where: sql`archived_at IS NULL`,',
        '  )',
      ].join('\n'),
    );
  });

  it('leaves attributes and policy entries inside // and /// comments alone', () => {
    const source = [
      'model Post {',
      '  id Int @id',
      '  // @@index([id], where: "id > 0")',
      '  /// @@check(expression: "id > 0")',
      '}',
      'policy_select p {',
      '  target = Post',
      '  // using = "old"',
      '  using = sql`true`',
      '}',
    ].join('\n');
    strictEqual(rewriteSqlStrings(source), source);
  });

  it('rewrites a policy entry whose string holds //', () => {
    strictEqual(
      rewriteSqlStrings(
        ['policy_select p {', '  target = Post', `  using = "url LIKE 'http://%'"`, '}'].join('\n'),
      ),
      ['policy_select p {', '  target = Post', "  using = sql`url LIKE 'http://%'`", '}'].join(
        '\n',
      ),
    );
  });

  it('rewrites an attribute argument whose string holds //', () => {
    strictEqual(
      rewriteSqlStrings(`  @@index([url], where: "url LIKE 'http://%'", name: "i")`),
      '  @@index([url], where: sql`url LIKE \'http://%\'`, name: "i")',
    );
  });

  it('writes a text with an escaped line break on its own lines', () => {
    strictEqual(
      rewriteSqlStrings('  @@check(expression: "a > 0\\nAND b > 0", name: "c")'),
      '  @@check(expression: sql`\na > 0\nAND b > 0\n`, name: "c")',
    );
  });
});

describe('printSqlLiteral', () => {
  for (const text of [
    'a > 0',
    "a <> '`'",
    '"quoted" = 1',
    "a ~ '\\\\d'",
    'a > 0\nAND b > 0',
    'a\n\nb',
    'x`y\nz',
  ]) {
    it(`prints ${JSON.stringify(text)} as the framework printer does`, () => {
      strictEqual(printSqlLiteral(text), printTaggedLiteral('sql', text));
    });
  }
});

const FRAGMENT_COPY =
  /(^|\/)sql-expression-literals-psl\/[^/]+\/scripts\/rewrite-sql-strings\.mjs$/;

function fragmentCopies() {
  const root = join(repositoryRoot, 'upgrade-instructions');
  return readdirSync(root, { recursive: true })
    .map((path) => path.split(sep).join('/'))
    .filter((path) => FRAGMENT_COPY.test(path))
    .map((path) => join(root, path));
}

describe('the upgrade fragments', () => {
  const canonical = readFileSync(join(here, 'rewrite-sql-strings.mjs'), 'utf8');
  const copies = fragmentCopies();

  it('carry at least one copy of the script, wherever the release has moved them', () => {
    strictEqual(copies.length > 0, true);
  });

  for (const path of copies) {
    it(`carry ${path.slice(repositoryRoot.length + 1)} byte for byte`, () => {
      strictEqual(readFileSync(path, 'utf8'), canonical);
    });
  }
});

describe('rewrite-sql-strings CLI', () => {
  it('rewrites matched schemas, reports each file and skips node_modules and dist', () => {
    const wip = join(repositoryRoot, 'wip');
    mkdirSync(wip, { recursive: true });
    const root = mkdtempSync(join(wip, 'rewrite-sql-strings-cli-'));
    const schema = 'model P {\n  id Int @id\n  @@check(expression: "id > 0", name: "c")\n}\n';
    const files = {
      'src/contract.prisma': schema,
      'node_modules/dep/contract.prisma': schema,
      'dist/contract.prisma': schema,
      'src/clean.prisma': 'model Q {\n  id Int @id\n}\n',
    };
    try {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), content);
      }
      const output = execFileSync(
        process.execPath,
        [join(here, 'rewrite-sql-strings.mjs'), '**/*.prisma'],
        { cwd: root, encoding: 'utf8' },
      );
      strictEqual(output, 'src/contract.prisma: 1 rewritten\n');
      strictEqual(
        readFileSync(join(root, 'src/contract.prisma'), 'utf8'),
        schema.replace('"id > 0"', 'sql`id > 0`'),
      );
      strictEqual(readFileSync(join(root, 'node_modules/dep/contract.prisma'), 'utf8'), schema);
      strictEqual(readFileSync(join(root, 'dist/contract.prisma'), 'utf8'), schema);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
