import type { PrismaNextConfig } from '@internal/config/config-types';
import { createControlStack } from '@internal/framework-components/control';
import { abortable } from '@internal/utils/abortable';
import { ifDefined } from '@internal/utils/defined';
import type { Diagnostic } from '@internal/utils/structured-error';
import { isStructuredErrorCode } from '@internal/utils/structured-error';
import { errorRuntime } from '../../utils/cli-errors';

type ContractConfig = NonNullable<PrismaNextConfig['contract']>;

export type ControlStack = ReturnType<typeof createControlStack>;

/** The contract the configured source produced, and the stack it was loaded against. */
export interface LoadedContractSource {
  readonly stack: ControlStack;
  readonly contract: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function failedToResolveContractSource(
  why: string,
  fix: string,
  meta?: Record<string, unknown>,
  cause?: unknown,
  diagnostics?: readonly Diagnostic[],
) {
  return errorRuntime('CONTRACT.SOURCE_LOAD_FAILED', 'Failed to resolve contract source', {
    why,
    fix,
    ...ifDefined('diagnostics', diagnostics),
    ...ifDefined('meta', meta),
    ...ifDefined('cause', cause),
  });
}

interface DiagnosticLocation {
  readonly sourceId: string | undefined;
  readonly line: number | undefined;
  readonly character: number | undefined;
}

function diagnosticLocation(diagnostic: Record<string, unknown>): DiagnosticLocation {
  const sourceId = typeof diagnostic['sourceId'] === 'string' ? diagnostic['sourceId'] : undefined;
  const span = isRecord(diagnostic['span']) ? diagnostic['span'] : undefined;
  const start = span && isRecord(span['start']) ? span['start'] : undefined;
  const line = start && typeof start['line'] === 'number' ? start['line'] : undefined;
  // biome-ignore lint/plugin/no-family-vocabulary: a text position in the source file; the span calls it column
  const character = start && typeof start['column'] === 'number' ? start['column'] : undefined;
  return { sourceId, line, character };
}

function formatLocation({ sourceId, line, character }: DiagnosticLocation): string | undefined {
  if (sourceId === undefined) return undefined;
  return line !== undefined && character !== undefined
    ? `${sourceId}:${line}:${character}`
    : sourceId;
}

/**
 * The finding the CLI prints under the error, one per source diagnostic. The
 * terminal renderer prints a finding's code and summary and nothing of its
 * `where`, so the summary starts with the location. A source code that is not
 * yet dotted is wrapped as `CONTRACT.SOURCE_DIAGNOSTIC` and named in the summary.
 */
function sourceDiagnosticToFinding(raw: unknown): Diagnostic | undefined {
  if (!isRecord(raw)) return undefined;
  const code = typeof raw['code'] === 'string' ? raw['code'] : 'diagnostic';
  const message = typeof raw['message'] === 'string' ? raw['message'] : '';
  const location = diagnosticLocation(raw);
  const formatted = formatLocation(location);
  const locatedSummary = (text: string) =>
    formatted === undefined ? text : `${formatted} ${text}`;
  const finding = {
    severity: 'error',
    nextActions: [],
    ...ifDefined(
      'where',
      location.sourceId === undefined
        ? undefined
        : { path: location.sourceId, ...ifDefined('line', location.line) },
    ),
  } as const;
  return isStructuredErrorCode(code)
    ? { code, summary: locatedSummary(message), ...finding }
    : {
        code: 'CONTRACT.SOURCE_DIAGNOSTIC',
        summary: locatedSummary(`${code}: ${message}`),
        ...finding,
        meta: { code },
      };
}

function sourceDiagnosticsToFindings(diagnostics: readonly unknown[]): Diagnostic[] {
  const findings: Diagnostic[] = [];
  for (const raw of diagnostics) {
    const finding = sourceDiagnosticToFinding(raw);
    if (finding !== undefined) findings.push(finding);
  }
  return findings;
}

type ValidatedProviderResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: ReturnType<typeof errorRuntime> };

function diagnosticLocationSuffix(diagnostic: Record<string, unknown>): string {
  const formatted = formatLocation(diagnosticLocation(diagnostic));
  return formatted === undefined ? '' : ` (${formatted})`;
}

function mapDiagnosticsToIssues(
  diagnostics: readonly unknown[],
): ReadonlyArray<{ readonly kind: string; readonly message: string }> {
  const issues: { readonly kind: string; readonly message: string }[] = [];
  for (const raw of diagnostics) {
    if (!isRecord(raw)) continue;
    const code = typeof raw['code'] === 'string' ? raw['code'] : 'diagnostic';
    const message = typeof raw['message'] === 'string' ? raw['message'] : '';
    issues.push({ kind: code, message: `${message}${diagnosticLocationSuffix(raw)}` });
  }
  return issues;
}

function validateProviderResult(providerResult: unknown): ValidatedProviderResult {
  if (!isRecord(providerResult) || typeof providerResult['ok'] !== 'boolean') {
    return {
      ok: false,
      error: failedToResolveContractSource(
        'Contract source provider returned malformed result shape.',
        'Ensure contract.source.load resolves to ok(Contract) or notOk({ summary, diagnostics }).',
      ),
    };
  }

  if (providerResult['ok']) {
    const value = providerResult['value'];
    if (value === undefined || value === null) {
      return {
        ok: false,
        error: failedToResolveContractSource(
          'Contract source provider returned malformed success result: missing value.',
          'Ensure contract.source.load success payload is ok(Contract).',
        ),
      };
    }
    return { ok: true, value };
  }

  const failure = providerResult['failure'];
  if (
    !isRecord(failure) ||
    typeof failure['summary'] !== 'string' ||
    !Array.isArray(failure['diagnostics'])
  ) {
    return {
      ok: false,
      error: failedToResolveContractSource(
        'Contract source provider returned malformed failure result: expected summary and diagnostics.',
        'Ensure contract.source.load failure payload is notOk({ summary, diagnostics, meta? }).',
      ),
    };
  }
  if (
    failure['diagnostics'].some(
      (diagnostic: unknown) => !isRecord(diagnostic) || typeof diagnostic['sourceId'] !== 'string',
    )
  ) {
    return {
      ok: false,
      error: failedToResolveContractSource(
        'Contract source provider returned malformed failure result: each diagnostic must include a string sourceId.',
        'Include the source filename in each diagnostic returned by contract.source.load.',
      ),
    };
  }
  return {
    ok: false,
    error: failedToResolveContractSource(
      String(failure['summary']),
      'Edit the schema where each finding points, then run contract emit again.',
      {
        diagnostics: failure['diagnostics'],
        issues: mapDiagnosticsToIssues(failure['diagnostics']),
        ...ifDefined('providerMeta', failure['meta']),
      },
      undefined,
      sourceDiagnosticsToFindings(failure['diagnostics']),
    ),
  };
}

/**
 * Builds the control stack, asks the configured contract source for the
 * contract, and turns every failure into `CONTRACT.SOURCE_LOAD_FAILED`. Shared
 * by `contract emit` and `contract print` so both report a bad source the
 * same way.
 *
 * @throws {CliStructuredError} `CONTRACT.SOURCE_LOAD_FAILED` when the source
 * cannot produce a contract
 * @throws {DOMException} `AbortError` if cancelled via `signal`
 */
export async function loadContractSource(inputs: {
  readonly config: PrismaNextConfig;
  readonly contractConfig: ContractConfig;
  readonly signal?: AbortSignal;
}): Promise<LoadedContractSource> {
  const { config, contractConfig } = inputs;
  const signal = inputs.signal ?? new AbortController().signal;
  const unlessAborted = abortable(signal);
  const stack = createControlStack(config);

  const sourceContext = {
    composedExtensions: stack.extensions.map((p) => p.id),
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: contractConfig.source.inputs ?? [],
    capabilities: stack.capabilities,
  };

  let providerResult: Awaited<ReturnType<typeof contractConfig.source.load>>;
  try {
    providerResult = await unlessAborted(contractConfig.source.load(sourceContext));
  } catch (error) {
    if (signal.aborted || (isRecord(error) && error['name'] === 'AbortError')) {
      throw error;
    }
    throw failedToResolveContractSource(
      error instanceof Error ? error.message : String(error),
      'Ensure contract.source.load resolves to ok(Contract) or returns structured diagnostics.',
      undefined,
      error,
    );
  }

  const validated = validateProviderResult(providerResult);
  if (!validated.ok) {
    throw validated.error;
  }
  return { stack, contract: validated.value };
}
