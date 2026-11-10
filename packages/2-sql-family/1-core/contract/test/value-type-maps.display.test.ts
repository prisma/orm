import { fileURLToPath } from 'node:url';
import { timeouts } from '@repo/test-utils';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Compiled as a virtual file beside this test, so its deliberate errors stay out of the package typecheck.
const virtualSource = fileURLToPath(new URL('./value-type-maps-display.ts', import.meta.url));
const sourceText = `
import type { FieldTypesFromDomain } from '@internal/contract/types';
import type { ColumnTypesFromStorage } from '../src/exports/types';

type CodecTypes = {
  readonly 'test/int8@1': { readonly input: bigint; readonly output: bigint };
  readonly 'test/text@1': { readonly input: string; readonly output: string };
};

type Domain = {
  readonly public: {
    readonly models: {
      readonly User: {
        readonly fields: {
          readonly score: {
            readonly nullable: true;
            readonly type: { readonly kind: 'scalar'; readonly codecId: 'test/int8@1' };
          };
          readonly tags: {
            readonly nullable: false;
            readonly type: { readonly kind: 'scalar'; readonly codecId: 'test/text@1' };
            readonly many: { readonly elementNullable: true };
          };
        };
      };
    };
  };
};

type Storage = {
  readonly namespaces: {
    readonly public: {
      readonly entries: {
        readonly table: {
          readonly users: {
            readonly columns: {
              readonly score: { readonly codecId: 'test/int8@1'; readonly nullable: true; readonly many: false };
            };
          };
        };
      };
    };
  };
};

type Fields = FieldTypesFromDomain<Domain, CodecTypes, never, {}, 'output', Storage['namespaces']>;
type Columns = ColumnTypesFromStorage<Storage, CodecTypes, never, {}, 'output'>;

declare const fields: Fields;
declare const columns: Columns;
export const score: number = fields.public.User.score;
export const tags: number = fields.public.User.tags;
export const column: number = columns.public.users.score;
`;

function diagnosticsOf(text: string): readonly string[] {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
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
  'errors name the type of a nullable or list value, not the generic that computes it',
  () => {
    expect(diagnosticsOf(sourceText).map((message) => message.split('.')[0])).toEqual([
      "Type 'bigint | null' is not assignable to type 'number'",
      "Type 'readonly (string | null)[]' is not assignable to type 'number'",
      "Type 'bigint | null' is not assignable to type 'number'",
    ]);
  },
  timeouts.typeScriptCompilation,
);
