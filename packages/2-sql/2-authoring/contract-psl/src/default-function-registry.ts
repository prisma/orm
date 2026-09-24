import type {
  ControlMutationDefaultRegistry,
  DefaultFunctionLoweringContext,
  LoweredDefaultResult,
  TypedDefaultFunctionCall,
} from '@internal/framework-components/control';

import type { DiagnosticSource, PslDiagnostic } from '@internal/psl-parser';

export type LoweredPslDefaultResult =
  | Extract<LoweredDefaultResult, { readonly ok: true }>
  | {
      readonly ok: false;
      readonly kind: 'owned';
      readonly diagnostic: PslDiagnostic;
    }
  | {
      readonly ok: false;
      readonly kind: 'external';
      readonly diagnostic: Extract<LoweredDefaultResult, { readonly ok: false }>['diagnostic'];
    };

function formatSupportedFunctionList(registry: ControlMutationDefaultRegistry): string {
  const signatures = Array.from(registry.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([functionName, entry]) => {
      const usageSignatures = entry.usageSignatures?.filter((signature) => signature.length > 0);
      return usageSignatures && usageSignatures.length > 0
        ? usageSignatures
        : [`${functionName}()`];
    });
  return signatures.length > 0 ? signatures.join(', ') : 'none';
}

/** The diagnostic message for a `dbgenerated(...)` call, which raw SQL tagged literals replaced. */
export function removedDbgeneratedMessage(registry: ControlMutationDefaultRegistry): string {
  return `Default function "dbgenerated" was removed. Write the SQL as a tagged literal: @default(sql\`<expression>\`). Supported functions: ${formatSupportedFunctionList(registry)}.`;
}

export function lowerDefaultFunctionWithRegistry(input: {
  readonly call: TypedDefaultFunctionCall;
  readonly registry: ControlMutationDefaultRegistry;
  readonly context: DefaultFunctionLoweringContext;
  readonly source: DiagnosticSource;
}): LoweredPslDefaultResult {
  const entry = input.registry.get(input.call.fn);
  if (entry) {
    const result = entry.lower({ call: input.call, context: input.context });
    return result.ok ? result : { ...result, kind: 'external' };
  }
  const supportedFunctionList = formatSupportedFunctionList(input.registry);

  return {
    ok: false,
    kind: 'owned',
    diagnostic: {
      code: 'PSL_UNKNOWN_DEFAULT_FUNCTION',
      message: `Default function "${input.call.fn}" is not supported in SQL PSL provider v1. Supported functions: ${supportedFunctionList}.`,
      ...input.source.at(input.call.span),
    },
  };
}
