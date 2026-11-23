import { buildSymbolTable } from '@prisma/orm-framework/psl-parser';
import { parse } from '@prisma/orm-framework/psl-parser/syntax';
import type { ContractSourceFile } from './edit-contract-source';

export interface NewDiagnostic {
  readonly path: string;
  readonly message: string;
  /** One-based. */
  readonly line: number;
}

/** What Prisma's published parser and symbol table report for a contract's source files: parse errors and duplicate declarations. */
function diagnosticsOf(
  files: readonly ContractSourceFile[],
  defaultNamespaceId: string,
): NewDiagnostic[] {
  const parsed = files.map((file) => parse(file.text, file.path));
  const [first, ...rest] = parsed.map(({ sources }) => sources);
  if (first === undefined) return [];
  const { diagnostics } = buildSymbolTable({
    documents: parsed.map(({ document }) => document),
    sources: first.merge(...rest),
    defaultNamespaceId,
  });
  return [...parsed.flatMap((result) => result.diagnostics), ...diagnostics].map(
    ({ filename, message, range }) => ({ path: filename, message, line: range.start.line + 1 }),
  );
}

function sameKey({ path, message }: NewDiagnostic): string {
  return `${path}\u0000${message}`;
}

/**
 * The first diagnostic the edited files have and the original files do not, counting each diagnostic as often as it occurs and ignoring where it is. The check is what a published entrypoint offers without the target's descriptors: parsing and the symbol table, not the binder or interpreter.
 */
export function firstNewDiagnostic(
  original: readonly ContractSourceFile[],
  edited: readonly ContractSourceFile[],
  defaultNamespaceId: string,
): NewDiagnostic | undefined {
  const remaining = new Map<string, number>();
  for (const diagnostic of diagnosticsOf(original, defaultNamespaceId)) {
    const key = sameKey(diagnostic);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  for (const diagnostic of diagnosticsOf(edited, defaultNamespaceId)) {
    const key = sameKey(diagnostic);
    const left = remaining.get(key) ?? 0;
    if (left === 0) return diagnostic;
    remaining.set(key, left - 1);
  }
  return undefined;
}
