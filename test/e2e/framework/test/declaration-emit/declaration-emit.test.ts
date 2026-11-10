/**
 * An application that exports a contract written with `defineContract`, or a row read through an emitted contract (`postgis-emitted-row.ts`), and builds with `declaration: true` needs TypeScript to name every type the contract's inferred type mentions. The public packages bundle the internal ones into chunks, so a type is nameable only when an export path of a public package reaches it. Each source here imports only the public packages, as an outside application does.
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourcesDir = join(dirname(fileURLToPath(import.meta.url)), 'sources');
const sources = readdirSync(sourcesDir)
  .filter((name) => name.endsWith('.ts'))
  .sort();

const applicationOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  exactOptionalPropertyTypes: true,
  declaration: true,
  emitDeclarationOnly: true,
  skipLibCheck: true,
  resolveJsonModule: true,
  types: [],
};

function declarationErrors(source: string): readonly string[] {
  const fileName = join(sourcesDir, source);
  const program = ts.createProgram([fileName], applicationOptions);
  const sourceFile = program.getSourceFile(fileName);
  const result = program.emit(sourceFile, () => {}, undefined, true);
  const diagnostics = [...ts.getPreEmitDiagnostics(program, sourceFile), ...result.diagnostics];
  return [
    ...new Set(
      diagnostics.map(
        (diagnostic) =>
          `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
      ),
    ),
  ];
}

describe('declaration emit of an exported contract, or of rows read through one, through the public packages', () => {
  it('has a source per contract shape', () => {
    expect(sources).toEqual([
      'citext.ts',
      'indexes.ts',
      'mixed.ts',
      'mongo.ts',
      'paradedb.ts',
      'pgvector.ts',
      'plain.ts',
      'postgis-emitted-row.ts',
      'postgis.ts',
      'sqlite.ts',
    ]);
  });

  it.each(sources)(
    '%s',
    (source) => {
      expect(declarationErrors(source)).toEqual([]);
    },
    timeouts.typeScriptCompilation,
  );
});
