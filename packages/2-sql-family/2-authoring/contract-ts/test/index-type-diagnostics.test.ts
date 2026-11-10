import { fileURLToPath } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Compiled as a virtual file beside this test, so its deliberate error stays out of the package typecheck.
const virtualSource = join(dirname(fileURLToPath(import.meta.url)), 'unregistered-index-type.ts');
const sourceText = `
import { field, model } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';

const int4 = columnDescriptor('pg/int4@1');

export const P = model('P', { fields: { id: field.column(int4).id(), a: field.column(int4) } }).sql(
  ({ cols, constraints }) => ({
    table: 'p',
    indexes: [constraints.index([cols.a], { name: 'a_hash', type: 'hash' })],
  }),
);
`;

function diagnosticsOf(text: string): readonly string[] {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    exactOptionalPropertyTypes: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) => fileName === virtualSource || fileExists(fileName);
  host.readFile = (fileName) => (fileName === virtualSource ? text : readFile(fileName));
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
    fileName === virtualSource
      ? ts.createSourceFile(fileName, text, languageVersion, true)
      : getSourceFile(fileName, languageVersion, onError, shouldCreate);
  const program = ts.createProgram([virtualSource], options, host);
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(virtualSource))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
}

it(
  'an index type no pack registers is refused with an error that names the type option',
  () => {
    expect(diagnosticsOf(sourceText)).toEqual([
      expect.stringContaining("'type' does not exist in type"),
    ]);
  },
  timeouts.typeScriptCompilation,
);
