import type {
  ContractSourceContext,
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
  ContractSourceProvider,
  PslContractSourceProvider,
} from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import { notOk, type Result } from '@internal/utils/result';
import type { PslSources } from './source-file';
import type { SymbolTable } from './symbol-table';
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
