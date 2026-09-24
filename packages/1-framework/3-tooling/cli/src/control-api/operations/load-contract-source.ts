import type {
  ContractSourceDiagnostics,
  ContractSourceProvider,
} from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import type { CliStructuredError } from '@internal/errors/control';
import type { ControlStack } from '@internal/framework-components/control';
import { abortable } from '@internal/utils/abortable';
import { ifDefined } from '@internal/utils/defined';
import type { Result } from '@internal/utils/result';
import { notOk, ok } from '@internal/utils/result';
import type { Diagnostic } from '@internal/utils/structured-error';
import { isStructuredErrorCode } from '@internal/utils/structured-error';
import { errorRuntime } from '../../utils/cli-errors';

/**
 * Why the configured source produced no contract: the error to report, and
 * the diagnostics the source returned, when it returned any.
 */
export interface ContractSourceLoadFailure {
  readonly error: CliStructuredError;
  readonly sourceDiagnostics?: ContractSourceDiagnostics;
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

type ContractSourceLoadResult = Result<Contract, ContractSourceLoadFailure>;

function failedWith(error: CliStructuredError): ContractSourceLoadResult {
  return notOk({ error });
}

/**
 * Checks the shape of what `load` returned. A source may be plain JavaScript,
 * so its declared type is not trusted.
 */
function validateProviderResult(
  providerResult: Result<Contract, ContractSourceDiagnostics>,
): ContractSourceLoadResult {
  const raw: unknown = providerResult;
  if (!isRecord(raw) || typeof raw['ok'] !== 'boolean') {
    return failedWith(
      failedToResolveContractSource(
        'Contract source provider returned malformed result shape.',
        'Ensure contract.source.load resolves to ok(Contract) or notOk({ summary, diagnostics }).',
      ),
    );
  }

  if (providerResult.ok) {
    const value: unknown = providerResult.value;
    if (value === undefined || value === null) {
      return failedWith(
        failedToResolveContractSource(
          'Contract source provider returned malformed success result: missing value.',
          'Ensure contract.source.load success payload is ok(Contract).',
        ),
      );
    }
    return ok(providerResult.value);
  }

  const failure: unknown = providerResult.failure;
  if (
    !isRecord(failure) ||
    typeof failure['summary'] !== 'string' ||
    !Array.isArray(failure['diagnostics'])
  ) {
    return failedWith(
      failedToResolveContractSource(
        'Contract source provider returned malformed failure result: expected summary and diagnostics.',
        'Ensure contract.source.load failure payload is notOk({ summary, diagnostics, meta? }).',
      ),
    );
  }
  if (
    failure['diagnostics'].some(
      (diagnostic: unknown) => !isRecord(diagnostic) || typeof diagnostic['sourceId'] !== 'string',
    )
  ) {
    return failedWith(
      failedToResolveContractSource(
        'Contract source provider returned malformed failure result: each diagnostic must include a string sourceId.',
        'Include the source filename in each diagnostic returned by contract.source.load.',
      ),
    );
  }
  return notOk({
    error: failedToResolveContractSource(
      failure['summary'],
      'Edit the source where each finding points, then run the command again.',
      {
        diagnostics: failure['diagnostics'],
        issues: mapDiagnosticsToIssues(failure['diagnostics']),
        ...ifDefined('providerMeta', failure['meta']),
      },
      undefined,
      sourceDiagnosticsToFindings(failure['diagnostics']),
    ),
    sourceDiagnostics: providerResult.failure,
  });
}

/**
 * Asks the configured contract source for the contract, with a source context
 * built from `stack`, and turns every failure into `CONTRACT.SOURCE_LOAD_FAILED`.
 * Every command that loads a contract source goes through here, so each
 * reports a bad source the same way.
 *
 * @throws {DOMException} `AbortError` if cancelled via `signal`
 */
export async function loadContractSource(inputs: {
  readonly stack: ControlStack;
  readonly source: ContractSourceProvider;
  readonly signal?: AbortSignal;
}): Promise<ContractSourceLoadResult> {
  const { stack, source } = inputs;
  const signal = inputs.signal ?? new AbortController().signal;
  const unlessAborted = abortable(signal);

  const sourceContext = {
    composedExtensions: stack.extensions.map((p) => p.id),
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    dataTypeLookup: stack.dataTypeLookup,
    resolvedInputs: source.inputs ?? [],
    capabilities: stack.capabilities,
  };

  let providerResult: Result<Contract, ContractSourceDiagnostics>;
  try {
    providerResult = await unlessAborted(source.load(sourceContext));
  } catch (error) {
    if (signal.aborted || (isRecord(error) && error['name'] === 'AbortError')) {
      throw error;
    }
    return failedWith(
      failedToResolveContractSource(
        error instanceof Error ? error.message : String(error),
        'Ensure contract.source.load resolves to ok(Contract) or returns structured diagnostics.',
        undefined,
        error,
      ),
    );
  }

  return validateProviderResult(providerResult);
}
