import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { singleLineDeclarations } from '@internal/migration-tools/contract-snapshot-store';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const EMITTED_DECLARATIONS = {
  postgres: join(import.meta.dirname, 'fixtures/contract.d.ts'),
  mongo: join(import.meta.dirname, 'mongo/fixtures/generated/contract.d.ts'),
};

function codeTokens(text: string): string[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const tokens: string[] = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    tokens.push(`${ts.SyntaxKind[kind]} ${scanner.getTokenText()}`);
  }
  return tokens;
}

function syntaxErrors(text: string): string[] {
  const source = ts.createSourceFile('contract.d.ts', text, ts.ScriptTarget.Latest);
  const { parseDiagnostics } = source as ts.SourceFile & {
    readonly parseDiagnostics: readonly ts.Diagnostic[];
  };
  return parseDiagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  );
}

describe('singleLineDeclarations on emitted contract.d.ts', () => {
  it.each(Object.entries(EMITTED_DECLARATIONS))('keeps the %s declarations', (_family, path) => {
    const emitted = readFileSync(path, 'utf-8');
    const singleLine = singleLineDeclarations(emitted);

    expect({
      emittedLines: emitted.split('\n').length > 2,
      tokens: codeTokens(singleLine),
      syntaxErrors: syntaxErrors(singleLine),
    }).toEqual({ emittedLines: true, tokens: codeTokens(emitted), syntaxErrors: [] });
  });
});
