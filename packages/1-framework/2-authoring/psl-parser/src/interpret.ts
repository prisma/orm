import type {
  ContractSourceContext,
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
  ContractSourceProvider,
  PslContractSourceProvider,
} from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import type { ParsedPslExtensionBlock } from '@internal/framework-components/psl-ast';
import { notOk, type Result } from '@internal/utils/result';
import type { PslSources } from './source-file';
import type { BlockSymbol, SymbolTable } from './symbol-table';
import type { DocumentAst } from './syntax/ast/declarations';

/**
 * Lets editor tooling that already parses incrementally (e.g. the language
 * server) hand cached artifacts to the interpreter instead of forcing a
 * disk re-parse.
 */
export interface PslInterpretInput {
  readonly documents: readonly DocumentAst[];
  readonly sources: PslSources;
  readonly symbolTable: SymbolTable;
  /**
   * The typed envelopes `buildSymbolTable` published for this table. Callers
   * that hold a `SymbolTableResult` thread it through so interpreters
   * consume the parser-owned lifecycle directly; an interpreter falls back
   * to `deriveParsedBlocks` only when a caller predating this field omits
   * it.
   */
  readonly parsedBlocks?: ReadonlyMap<BlockSymbol, ParsedPslExtensionBlock>;
}

/**
 * Declared here — the authoring layer that owns `DocumentAst` / `PslSources` /
 * `SymbolTable` — because `@internal/config` (core) cannot name authoring
 * types. `interpret` must not read disk or `context.resolvedInputs` — those
 * are load-path concerns.
 */
export interface PslInterpretCapable extends PslContractSourceProvider {
  interpret(
    input: PslInterpretInput,
    context: ContractSourceContext,
  ): Result<Contract, ContractSourceDiagnostics>;
}

/**
 * Merges caller-side diagnostics (e.g. parse / symbol-table findings) into an
 * interpretation result. The authored headline is deliberately uniform — it
 * reports how many errors the schema has, never which pipeline stage found
 * them.
 */
export function withSeedDiagnostics(
  result: Result<Contract, ContractSourceDiagnostics>,
  seedDiagnostics: readonly ContractSourceDiagnostic[],
): Result<Contract, ContractSourceDiagnostics> {
  if (seedDiagnostics.length === 0) {
    return result;
  }
  const diagnostics = result.ok
    ? seedDiagnostics
    : [...seedDiagnostics, ...result.failure.diagnostics];
  return notOk({
    summary: `Schema has ${diagnostics.length} error${diagnostics.length === 1 ? '' : 's'}`,
    diagnostics,
    ...(result.ok || result.failure.meta === undefined ? {} : { meta: result.failure.meta }),
  });
}

/** The single seam that narrows a contract source to the interpret capability. */
export function hasPslInterpreter(source: ContractSourceProvider): source is PslInterpretCapable {
  return source.format === 'psl' && 'interpret' in source && typeof source.interpret === 'function';
}
