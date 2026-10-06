import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { dirname, resolve } from 'pathe';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const demoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const librarySource = resolve(demoRoot, 'test/fixtures/declaration-library.ts');
const libraryDeclaration = resolve(demoRoot, 'test/fixtures/declaration-library.d.ts');
const consumerSource = resolve(demoRoot, 'test/fixtures/declaration-consumer.ts');
const temporalGlobals = resolve(demoRoot, 'src/temporal-global.d.ts');
const packagesBehindTheFacade = ['@prisma/orm-family-sql/', '@prisma/orm-framework/'];
const facadeManifest = createRequire(resolve(demoRoot, 'package.json')).resolve(
  '@prisma/orm-postgres/package.json',
);

function demoCompilerOptions(): ts.CompilerOptions {
  const config = ts.getParsedCommandLineOfConfigFile(
    resolve(demoRoot, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  if (!config) throw new Error('tsconfig.json could not be read');
  return config.options;
}

function messages(diagnostics: readonly ts.Diagnostic[]): string[] {
  const texts = diagnostics.map((diagnostic) => {
    const where = diagnostic.file
      ? `${diagnostic.file.fileName.slice(demoRoot.length + 1)}(${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1}): `
      : '';
    return `${where}TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`;
  });
  return [...new Set(texts)];
}

function emitLibraryDeclaration(options: ts.CompilerOptions) {
  const program = ts.createProgram([temporalGlobals, librarySource], {
    ...options,
    noEmit: false,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
  });
  let declaration = '';
  const result = program.emit(
    program.getSourceFile(librarySource),
    (_name, text) => {
      declaration = text;
    },
    undefined,
    true,
  );
  return {
    diagnostics: messages([
      ...ts.getPreEmitDiagnostics(program, program.getSourceFile(librarySource)),
      ...result.diagnostics,
    ]),
    declaration,
  };
}

/**
 * Typechecks the consumer against the emitted declaration instead of the library's source.
 *
 * The emitted declaration names `@prisma/orm-family-sql/*` and `@prisma/orm-framework/*`, the packages
 * behind the facade, which the demo does not depend on, so under pnpm they do not resolve from the
 * demo (TML-3433). Until that is fixed, those specifiers, and only those, are resolved from the facade
 * package when the emitted declaration imports them, as a hoisted install would. Any other name that
 * does not resolve fails the check.
 */
function checkConsumer(options: ts.CompilerOptions, declaration: string) {
  const host = ts.createCompilerHost(options);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) =>
    fileName === libraryDeclaration || (fileName !== librarySource && fileExists(fileName));
  host.readFile = (fileName) =>
    fileName === libraryDeclaration ? declaration : readFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
    fileName === libraryDeclaration
      ? ts.createSourceFile(fileName, declaration, languageVersion, true)
      : getSourceFile(fileName, languageVersion, onError, shouldCreate);
  host.resolveModuleNameLiterals = (literals, containingFile, _redirect, compilerOptions) =>
    literals.map((literal) => {
      const fromImporter = ts.resolveModuleName(
        literal.text,
        containingFile,
        compilerOptions,
        host,
      );
      return fromImporter.resolvedModule ||
        containingFile !== libraryDeclaration ||
        !packagesBehindTheFacade.some((prefix) => literal.text.startsWith(prefix))
        ? fromImporter
        : ts.resolveModuleName(literal.text, facadeManifest, compilerOptions, host);
    });

  const program = ts.createProgram(
    [temporalGlobals, consumerSource],
    { ...options, noEmit: true, skipLibCheck: false },
    host,
  );
  const checked = [
    program.getSourceFile(libraryDeclaration),
    program.getSourceFile(consumerSource),
  ];
  return messages(
    checked.flatMap((file) => [
      ...program.getSyntacticDiagnostics(file),
      ...program.getSemanticDiagnostics(file),
    ]),
  );
}

describe('declaration emit through the published facade', () => {
  const options = demoCompilerOptions();
  const emitted = emitLibraryDeclaration(options);

  it(
    'emits a library that exports custom collection classes with unannotated methods',
    () => {
      expect(emitted.diagnostics).toEqual([]);
      expect(emitted.declaration).toContain('declare class PostLibrary');
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'gives a consumer of the emitted declaration the same types as the source',
    () => {
      expect(checkConsumer(options, emitted.declaration)).toEqual([]);
    },
    timeouts.typeScriptCompilation,
  );
});
