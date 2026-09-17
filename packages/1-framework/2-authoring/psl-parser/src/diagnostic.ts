import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { ContributedPslDiagnosticCode, PslSpan } from '@internal/framework-components/psl-ast';
import type { PslSources, Range } from './source-file';
import type { SyntaxNode } from './syntax/red';

export interface PslDiagnostic {
  readonly filename: string;
  readonly code: ContributedPslDiagnosticCode;
  readonly message: string;
  readonly range: Range;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface DiagnosticSource {
  readonly sources: PslSources;
  readonly node: SyntaxNode;
  at(span: PslSpan): Pick<PslDiagnostic, 'filename' | 'range'>;
}

export function diagnosticSource(sources: PslSources, node: SyntaxNode): DiagnosticSource {
  return {
    sources,
    node,
    at(span) {
      const sourceFile = sources.sourceFileFor(node);
      return { filename: sourceFile.filename, range: sourceFile.pslSpanToRange(span) };
    },
  };
}

export interface PslDiagnosticCollector {
  readonly length: number;
  push(...diagnostics: readonly PslDiagnostic[]): void;
  pushExternal(...diagnostics: readonly ContractSourceDiagnostic[]): void;
  toExternal(): ContractSourceDiagnostic[];
}

export function mapPslDiagnostics(
  diagnostics: readonly PslDiagnostic[],
  sources: PslSources,
): ContractSourceDiagnostic[] {
  return diagnostics.map(({ filename, code, message, range, data }) => ({
    code,
    message,
    sourceId: filename,
    span: sources.sourceFileNamed(filename).rangeToPslSpan(range),
    ...(data === undefined ? {} : { data }),
  }));
}

type DiagnosticEntry =
  | { readonly kind: 'psl'; readonly diagnostic: PslDiagnostic }
  | { readonly kind: 'external'; readonly diagnostic: ContractSourceDiagnostic };

export function createPslDiagnosticCollector(sources: PslSources): PslDiagnosticCollector {
  const entries: DiagnosticEntry[] = [];
  return {
    get length() {
      return entries.length;
    },
    push(...diagnostics) {
      for (const diagnostic of diagnostics) entries.push({ kind: 'psl', diagnostic });
    },
    pushExternal(...diagnostics) {
      for (const diagnostic of diagnostics) entries.push({ kind: 'external', diagnostic });
    },
    toExternal() {
      return entries.flatMap((entry) =>
        entry.kind === 'external'
          ? [entry.diagnostic]
          : mapPslDiagnostics([entry.diagnostic], sources),
      );
    },
  };
}
