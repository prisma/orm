import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { PslSpan } from '@internal/framework-components/psl-ast';
import { InternalError } from '@internal/utils/internal-error';
import type { PslSources, Range } from './source-file';
import type { SyntaxNode } from './syntax/red';

export interface PslDiagnostic {
  readonly filename: string;
  readonly code: string;
  readonly message: string;
  readonly range: Range;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface DiagnosticSource {
  readonly sources: PslSources;
  readonly node: SyntaxNode;
  at(span?: PslSpan): Pick<PslDiagnostic, 'filename' | 'range'>;
}

export function diagnosticSource(sources: PslSources, node: SyntaxNode): DiagnosticSource {
  return {
    sources,
    node,
    at(span) {
      const sourceFile = sources.sourceFileFor(node);
      const range =
        span === undefined
          ? {
              start: sourceFile.positionAt(node.offset),
              end: sourceFile.positionAt(node.endOffset),
            }
          : sourceFile.pslSpanToRange(span);
      return { filename: sourceFile.filename, range };
    },
  };
}

export function diagnosticFromSpan(
  diagnostic: Pick<ContractSourceDiagnostic, 'code' | 'message' | 'span' | 'data'>,
  source: DiagnosticSource,
): PslDiagnostic {
  if (diagnostic.span === undefined) throw new InternalError('Owned PSL diagnostic has no span');
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    ...source.at(diagnostic.span),
    ...(diagnostic.data === undefined ? {} : { data: diagnostic.data }),
  };
}

export interface PslDiagnosticCollector {
  readonly length: number;
  push(...diagnostics: readonly PslDiagnostic[]): void;
  pushExternal(...diagnostics: readonly ContractSourceDiagnostic[]): void;
  pushUnlocated(...diagnostics: readonly PslDiagnostic[]): void;
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
  | { readonly kind: 'psl'; readonly diagnostic: PslDiagnostic; readonly omitSpan?: boolean }
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
    pushUnlocated(...diagnostics) {
      for (const diagnostic of diagnostics)
        entries.push({ kind: 'psl', diagnostic, omitSpan: true });
    },
    pushExternal(...diagnostics) {
      for (const diagnostic of diagnostics) entries.push({ kind: 'external', diagnostic });
    },
    toExternal() {
      return entries.flatMap((entry) => {
        if (entry.kind === 'external') return [entry.diagnostic];
        if (entry.omitSpan) {
          const { code, message, filename, data } = entry.diagnostic;
          return [{ code, message, sourceId: filename, ...(data === undefined ? {} : { data }) }];
        }
        return mapPslDiagnostics([entry.diagnostic], sources);
      });
    },
  };
}
