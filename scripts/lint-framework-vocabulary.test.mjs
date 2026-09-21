import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execPath } from 'node:process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dedupeSites, filterVocabularyDiags } from './lint-framework-vocabulary.mjs';

const SCRIPT_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  'lint-framework-vocabulary.mjs',
);

// The plugin is scoped to packages/1-framework by a $filename guard, so
// fixtures have to live under that path to be seen at all.
const SCOPE = 'packages/1-framework';

// One site, on line 1.
const FILE_ONE_SITE = "export const nativeType = 'int4';\n";
// Several diagnostics on a single line: two identifiers plus a string literal.
const FILE_ONE_LINE_MANY_TERMS = "export const columnTable = 'postgres table';\n";
// Vocabulary only in comments.
const FILE_COMMENTS_ONLY =
  '// a postgres table column\n/**\n * nativeType, primary key, mongo collection\n */\nexport const x = 1;\n';
const FILE_SOURCE_COORDINATES =
  'export function offsetToPslPosition(offset, position) { return { offset, line: position.line + 1, column: position.character + 1 }; }\n';
const FILE_ZERO_SPAN_COORDINATES =
  'const ZERO_SPAN = { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } };\n';
const FILE_SOURCE_COORDINATES_WITH_STORAGE_COLUMN = `${FILE_SOURCE_COORDINATES}export const column = 1;\n`;
const FILE_SOURCE_COORDINATES_WITH_STORAGE_COLUMN_MEMBER = `${FILE_SOURCE_COORDINATES}export const storage = { column: 'id' };\n`;
const FILE_SOURCE_COORDINATES_WITH_STORAGE_STRING_KEY = `${FILE_SOURCE_COORDINATES}export const storage = { 'column': 'id' };\n`;
const FILE_SYMBOL_TABLE =
  'export interface SymbolTableResult { readonly symbolTable: SymbolTable }\nconst symbolTable = {};\nexport function buildSymbolTable() { return { symbolTable }; }\n';
const FILE_SYMBOL_TABLE_WITH_STORAGE_TABLE = `${FILE_SYMBOL_TABLE}export const storageTable = 1;\n`;
const FILE_LANGUAGE_SERVER_SYMBOL_TABLE_ACCESS =
  'const { symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({ document, sources });\n';
const FILE_LANGUAGE_SERVER_SYMBOL_TABLE_WITH_STORAGE_TABLE_ARGUMENT =
  'const { symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({\n  document,\n  sources,\n  pslBlockDescriptors: storage.table,\n});\n';
const FILE_LANGUAGE_SERVER_SYMBOL_TABLE_WITH_TABLE_LITERAL_ARGUMENT =
  'const { symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({\n  document,\n  sources,\n  pslBlockDescriptors: {\n    table: value,\n  },\n});\n';
const FILE_LANGUAGE_SERVER_DIRECT_SYMBOL_TABLE_ACCESS =
  'const symbolTable = buildSymbolTable(symbolTableInput).symbolTable;\n';
const FILE_LANGUAGE_SERVER_UNRELATED_SYMBOL_RESULT_TABLE =
  'const symbolResult = getStorage();\nconst result = symbolResult.table;\n';
const FILE_LANGUAGE_SERVER_ALIAS_TABLE =
  'const symbolResult = getStorage();\nconst storageAlias = symbolResult;\nconst result = storageAlias.table;\n';
const FILE_LANGUAGE_SERVER_SHADOWED_SYMBOL_RESULT_TABLE = `${FILE_LANGUAGE_SERVER_SYMBOL_TABLE_ACCESS}function read(symbolResult) { return symbolResult.table; }\n`;
const FILE_LANGUAGE_SERVER_SYMBOL_TABLE_WITH_STORAGE_TABLE = `${FILE_LANGUAGE_SERVER_SYMBOL_TABLE_ACCESS}const storage = getStorage();\nconst result = storage.table;\n`;
const FILE_FORMATTER_ALIGNMENT_COLUMNS =
  'export function alignmentColumns(rows) { const typeColumn = 1; return { typeColumn, attributeColumn: 2 }; }\n';
const FILE_FORMATTER_ALIGNMENT_WITH_STORAGE_COLUMN = `${FILE_FORMATTER_ALIGNMENT_COLUMNS}export const storageColumn = 1;\n`;
const FILE_FORBIDDEN_STORAGE_VOCABULARY =
  'export interface StorageShape { readonly tableName: string; readonly columnName: string; readonly nativeType: string; }\n';

let repo;

function git(...args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeRepoFile(relPath, content) {
  const full = join(repo, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function writeConfig(threshold) {
  writeRepoFile(
    'scripts/lint-framework-vocabulary.config.json',
    JSON.stringify({ scopes: [{ path: SCOPE, threshold }] }, null, 2),
  );
}

function runScript(...args) {
  return spawnSync(execPath, [SCRIPT_PATH, ...args], { cwd: repo, encoding: 'utf-8' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'pn-lint-framework-vocab-'));
  git('init', '--quiet', '--initial-branch=main');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('filterVocabularyDiags', () => {
  it('keeps plugin diagnostics with the no-family-vocabulary prefix', () => {
    const kept = filterVocabularyDiags([
      { category: 'plugin', message: 'no-family-vocabulary: family/target vocabulary' },
      { category: 'lint', message: 'no-family-vocabulary: wrong category' },
      { category: 'plugin', message: 'no-bare-cast: a different plugin' },
    ]);
    assert.equal(kept.length, 1);
    assert.match(kept[0].message, /^no-family-vocabulary:/);
  });

  it('returns empty array when no diagnostics match', () => {
    assert.deepEqual(filterVocabularyDiags([]), []);
    assert.deepEqual(filterVocabularyDiags([{ category: 'lint', message: 'x' }]), []);
  });
});

describe('dedupeSites', () => {
  const diag = (path, line) => ({
    category: 'plugin',
    message: 'no-family-vocabulary: x',
    location: { path, start: { line } },
  });

  it('collapses repeated diagnostics on one line to a single site', () => {
    assert.deepEqual(dedupeSites([diag('a.ts', 3), diag('a.ts', 3), diag('a.ts', 3)]), ['a.ts:3']);
  });

  it('keeps distinct lines and distinct files apart', () => {
    assert.deepEqual(dedupeSites([diag('a.ts', 3), diag('a.ts', 4), diag('b.ts', 3)]), [
      'a.ts:3',
      'a.ts:4',
      'b.ts:3',
    ]);
  });

  it('ignores diagnostics from other plugins', () => {
    assert.deepEqual(
      dedupeSites([diag('a.ts', 1), { category: 'plugin', message: 'no-bare-cast: x' }]),
      ['a.ts:1'],
    );
  });
});

describe('lint-framework-vocabulary — threshold met', () => {
  it('exits 0 when count equals threshold', () => {
    writeConfig(1);
    writeRepoFile(`${SCOPE}/src/app.ts`, FILE_ONE_SITE);

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=1 threshold=1/);
  });
});

describe('lint-framework-vocabulary — count above threshold', () => {
  it('exits 1 and instructs removing violations or raising the threshold', () => {
    writeConfig(0);
    writeRepoFile(`${SCOPE}/src/app.ts`, FILE_ONE_SITE);

    const result = runScript();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stdout, /count=1 threshold=0/);
    assert.match(result.stderr, /raise.*threshold|remove/i);
  });

  it('names the suppression comment in the failure advice', () => {
    writeConfig(0);
    writeRepoFile(`${SCOPE}/src/app.ts`, FILE_ONE_SITE);

    const result = runScript();
    assert.match(result.stderr, /biome-ignore lint\/plugin\/no-family-vocabulary/);
  });
});

describe('lint-framework-vocabulary — count below threshold', () => {
  it('exits 1 and instructs lowering the threshold', () => {
    writeConfig(5);
    writeRepoFile(`${SCOPE}/src/app.ts`, FILE_ONE_SITE);

    const result = runScript();
    assert.equal(result.status, 1, `expected exit 1; stdout=${result.stdout}`);
    assert.match(result.stdout, /count=1 threshold=5/);
    assert.match(result.stderr, /lower.*threshold/i);
  });
});

describe('lint-framework-vocabulary — counting', () => {
  it('counts a line carrying several terms once', () => {
    writeConfig(1);
    writeRepoFile(`${SCOPE}/src/app.ts`, FILE_ONE_LINE_MANY_TERMS);

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=1 threshold=1/);
  });

  it('counts bare column keys even in source-coordinate positions', () => {
    writeConfig(2);
    writeRepoFile(`${SCOPE}/2-authoring/psl-parser/src/source-file.ts`, FILE_SOURCE_COORDINATES);
    writeRepoFile(
      `${SCOPE}/2-authoring/psl-parser/src/extension-block.ts`,
      FILE_ZERO_SPAN_COORDINATES,
    );

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=2 threshold=2/);
  });

  it('does not count parser symbol tables or formatter alignment columns as family vocabulary', () => {
    writeConfig(0);
    writeRepoFile(`${SCOPE}/2-authoring/psl-parser/src/symbol-table.ts`, FILE_SYMBOL_TABLE);
    writeRepoFile(
      `${SCOPE}/2-authoring/psl-parser/src/format/emit.ts`,
      FILE_FORMATTER_ALIGNMENT_COLUMNS,
    );

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=0 threshold=0/);
  });

  it('does not count language-server buildSymbolTable result access as family vocabulary', () => {
    writeConfig(0);
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/pipeline.ts`,
      FILE_LANGUAGE_SERVER_SYMBOL_TABLE_ACCESS,
    );
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/project-artifacts.ts`,
      FILE_LANGUAGE_SERVER_DIRECT_SYMBOL_TABLE_ACCESS,
    );

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=0 threshold=0/);
  });

  it('still counts storage.table inside buildSymbolTable call arguments', () => {
    writeConfig(2);
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/pipeline.ts`,
      FILE_LANGUAGE_SERVER_SYMBOL_TABLE_WITH_STORAGE_TABLE_ARGUMENT,
    );
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/project-artifacts.ts`,
      FILE_LANGUAGE_SERVER_SYMBOL_TABLE_WITH_STORAGE_TABLE_ARGUMENT,
    );

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=2 threshold=2/);
  });

  it('still counts table object-literal members inside buildSymbolTable call arguments', () => {
    writeConfig(2);
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/pipeline.ts`,
      FILE_LANGUAGE_SERVER_SYMBOL_TABLE_WITH_TABLE_LITERAL_ARGUMENT,
    );
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/project-artifacts.ts`,
      FILE_LANGUAGE_SERVER_SYMBOL_TABLE_WITH_TABLE_LITERAL_ARGUMENT,
    );

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=2 threshold=2/);
  });

  it('still counts unrelated symbolResult.table access in language-server files', () => {
    writeConfig(2);
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/pipeline.ts`,
      FILE_LANGUAGE_SERVER_UNRELATED_SYMBOL_RESULT_TABLE,
    );
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/project-artifacts.ts`,
      FILE_LANGUAGE_SERVER_UNRELATED_SYMBOL_RESULT_TABLE,
    );

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=2 threshold=2/);
  });

  it('still counts aliased table access in language-server files', () => {
    writeConfig(2);
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/pipeline.ts`,
      FILE_LANGUAGE_SERVER_ALIAS_TABLE,
    );
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/project-artifacts.ts`,
      FILE_LANGUAGE_SERVER_ALIAS_TABLE,
    );

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=2 threshold=2/);
  });

  it('still counts shadowed symbolResult.table access in language-server files', () => {
    writeConfig(2);
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/pipeline.ts`,
      FILE_LANGUAGE_SERVER_SHADOWED_SYMBOL_RESULT_TABLE,
    );
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/project-artifacts.ts`,
      FILE_LANGUAGE_SERVER_SHADOWED_SYMBOL_RESULT_TABLE,
    );

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=2 threshold=2/);
  });

  it('still counts storage table vocabulary beside language-server symbol-table access', () => {
    writeConfig(2);
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/pipeline.ts`,
      FILE_LANGUAGE_SERVER_SYMBOL_TABLE_WITH_STORAGE_TABLE,
    );
    writeRepoFile(
      `${SCOPE}/3-tooling/language-server/src/project-artifacts.ts`,
      FILE_LANGUAGE_SERVER_SYMBOL_TABLE_WITH_STORAGE_TABLE,
    );

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=2 threshold=2/);
  });

  it('still counts genuine storage vocabulary in framework code', () => {
    writeConfig(1);
    writeRepoFile(`${SCOPE}/src/storage-shape.ts`, FILE_FORBIDDEN_STORAGE_VOCABULARY);

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=1 threshold=1/);
  });

  for (const filename of ['source-file.ts', 'extension-block.ts']) {
    for (const [kind, content] of [
      ['identifier', FILE_SOURCE_COORDINATES_WITH_STORAGE_COLUMN],
      ['member', FILE_SOURCE_COORDINATES_WITH_STORAGE_COLUMN_MEMBER],
      ['string key', FILE_SOURCE_COORDINATES_WITH_STORAGE_STRING_KEY],
    ]) {
      it(`counts both coordinate and storage column ${kind} in ${filename}`, () => {
        writeConfig(2);
        writeRepoFile(`${SCOPE}/2-authoring/psl-parser/src/${filename}`, content);

        const result = runScript();
        assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
        assert.match(result.stdout, /count=2 threshold=2/);
      });
    }
  }

  for (const filename of [
    '2-authoring/psl-parser/src/symbol-table.ts',
    '2-authoring/psl-parser/src/format/emit.ts',
    '3-tooling/language-server/src/pipeline.ts',
    '3-tooling/language-server/src/project-artifacts.ts',
    'src/other.ts',
  ]) {
    it(`allows explicit compounds in ${filename}`, () => {
      writeConfig(0);
      writeRepoFile(`${SCOPE}/${filename}`, FILE_SYMBOL_TABLE + FILE_FORMATTER_ALIGNMENT_COLUMNS);

      const result = runScript();
      assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
      assert.match(result.stdout, /count=0 threshold=0/);
    });

    it(`counts bare terms beside allowed compounds in ${filename}`, () => {
      writeConfig(4);
      writeRepoFile(
        `${SCOPE}/${filename}`,
        'const table = symbolTable;\nconst tables = symbolTable;\nconst column = alignmentColumns([]);\nconst columns = alignmentColumns([]);\n',
      );

      const result = runScript();
      assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
      assert.match(result.stdout, /count=4 threshold=4/);
    });
  }

  it('still counts storage table vocabulary in parser symbol-table code', () => {
    writeConfig(1);
    writeRepoFile(
      `${SCOPE}/2-authoring/psl-parser/src/symbol-table.ts`,
      FILE_SYMBOL_TABLE_WITH_STORAGE_TABLE,
    );

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=1 threshold=1/);
  });

  it('still counts storage column vocabulary in formatter code', () => {
    writeConfig(1);
    writeRepoFile(
      `${SCOPE}/2-authoring/psl-parser/src/format/emit.ts`,
      FILE_FORMATTER_ALIGNMENT_WITH_STORAGE_COLUMN,
    );

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=1 threshold=1/);
  });

  it('does not count vocabulary in comments or JSDoc', () => {
    writeConfig(0);
    writeRepoFile(`${SCOPE}/src/app.ts`, FILE_COMMENTS_ONLY);

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=0 threshold=0/);
  });

  it('honours a biome-ignore suppression naming this plugin', () => {
    writeConfig(0);
    writeRepoFile(
      `${SCOPE}/src/app.ts`,
      `// biome-ignore lint/plugin/no-family-vocabulary: terminal layout, not storage\n${FILE_ONE_SITE}`,
    );

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=0 threshold=0/);
  });

  it('lists each site as file:line under --list', () => {
    writeConfig(1);
    writeRepoFile(`${SCOPE}/src/app.ts`, FILE_ONE_SITE);

    const result = runScript('--list');
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, new RegExp(`${SCOPE}/src/app\\.ts:1`));
  });
});

describe('lint-framework-vocabulary — exclusions', () => {
  it('ignores test files and test directories', () => {
    writeConfig(0);
    writeRepoFile(`${SCOPE}/src/app.test.ts`, FILE_ONE_SITE);
    writeRepoFile(`${SCOPE}/src/app.test-d.ts`, FILE_ONE_SITE);
    writeRepoFile(`${SCOPE}/test/app.ts`, FILE_ONE_SITE);

    const result = runScript();
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /count=0 threshold=0/);
  });
});
