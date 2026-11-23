import { buildSymbolTable } from '@prisma/orm-framework/psl-parser';
import { parse } from '@prisma/orm-framework/psl-parser/syntax';
import type { ContractSourceFile } from './edit-contract-source';

export interface NewDiagnostic {
  readonly path: string;
  readonly message: string;
  /** One-based. */
  readonly line: number;
}

/** Text the edit inserted into a file: `length` characters at `offset` of the original text. */
export interface InsertedText {
  readonly path: string;
  readonly offset: number;
  readonly length: number;
}

interface LocatedDiagnostic extends NewDiagnostic {
  readonly offset: number;
}

function offsetOf(text: string, line: number, character: number): number {
  let offset = 0;
  for (let current = 0; current < line; current += 1) {
    const newline = text.indexOf('\n', offset);
    if (newline === -1) return text.length;
    offset = newline + 1;
  }
  return offset + character;
}

/** What Prisma's published parser and symbol table report for a contract's source files: parse errors and duplicate declarations. */
function diagnosticsOf(
  files: readonly ContractSourceFile[],
  defaultNamespaceId: string,
): LocatedDiagnostic[] {
  const parsed = files.map((file) => parse(file.text, file.path));
  const [first, ...rest] = parsed.map(({ sources }) => sources);
  if (first === undefined) return [];
  const { diagnostics } = buildSymbolTable({
    documents: parsed.map(({ document }) => document),
    sources: first.merge(...rest),
    defaultNamespaceId,
  });
  const textOf = new Map(files.map((file) => [file.path, file.text]));
  return [...parsed.flatMap((result) => result.diagnostics), ...diagnostics].map(
    ({ filename, message, range }) => ({
      path: filename,
      message,
      line: range.start.line + 1,
      offset: offsetOf(textOf.get(filename) ?? '', range.start.line, range.start.character),
    }),
  );
}

function keyOf({ path, message, offset }: LocatedDiagnostic): string {
  return `${path}\u0000${message}\u0000${offset}`;
}

/**
 * The first diagnostic the edited files have and the original files do not. Each original diagnostic is moved by the text the edit inserted before it, so a diagnostic the original already had is matched where it now is, and the one returned is where the edit put it. The check is what a published entrypoint offers without the target's descriptors: parsing and the symbol table, not the binder or interpreter.
 */
export function firstNewDiagnostic(
  original: readonly ContractSourceFile[],
  edited: readonly ContractSourceFile[],
  defaultNamespaceId: string,
  inserted: readonly InsertedText[],
): NewDiagnostic | undefined {
  const remaining = new Map<string, number>();
  for (const diagnostic of diagnosticsOf(original, defaultNamespaceId)) {
    const shift = inserted
      .filter(({ path, offset }) => path === diagnostic.path && offset <= diagnostic.offset)
      .reduce((total, { length }) => total + length, 0);
    const key = keyOf({ ...diagnostic, offset: diagnostic.offset + shift });
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  for (const diagnostic of diagnosticsOf(edited, defaultNamespaceId)) {
    const key = keyOf(diagnostic);
    const left = remaining.get(key) ?? 0;
    if (left === 0)
      return { path: diagnostic.path, message: diagnostic.message, line: diagnostic.line };
    remaining.set(key, left - 1);
  }
  return undefined;
}
