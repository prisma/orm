import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
  ContractSourceProvider,
  PrismaNextConfig,
} from '@internal/config/config-types';
import { expandContractInputs } from '@internal/config-loader';
import type { Contract } from '@internal/contract/types';
import type { CliStructuredError } from '@internal/errors/control';
import { type ControlStack, createControlStack } from '@internal/framework-components/control';
import { abortable } from '@internal/utils/abortable';
import { ifDefined } from '@internal/utils/defined';
import type { Result } from '@internal/utils/result';
import { notOk, ok } from '@internal/utils/result';
import type { Diagnostic } from '@internal/utils/structured-error';
import { isStructuredErrorCode } from '@internal/utils/structured-error';
import { isAbsolute, relative } from 'pathe';
import { errorContractConfigMissing, errorRuntime } from '../../utils/cli-errors';

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

/** A file the source names by its absolute path is shown relative to the working directory, as a user would type it. */
function displayLocation(
  location: DiagnosticLocation,
  cwd: string | undefined,
): DiagnosticLocation {
  const { sourceId } = location;
  return cwd !== undefined && sourceId !== undefined && isAbsolute(sourceId)
    ? { ...location, sourceId: relative(cwd, sourceId) }
    : location;
}

function formatLocation({ sourceId, line, character }: DiagnosticLocation): string | undefined {
  if (sourceId === undefined) return undefined;
  return line !== undefined && character !== undefined
    ? `${sourceId}:${line}:${character}`
    : sourceId;
}

/** One source diagnostic as a line of text: `<sourceId>:<line>:<column> <code> <message>`. */
export function formatSourceDiagnostic(raw: unknown): string {
  if (!isRecord(raw)) return String(raw);
  const code = typeof raw['code'] === 'string' ? raw['code'] : 'diagnostic';
  const message = typeof raw['message'] === 'string' ? raw['message'] : '';
  const location = formatLocation(diagnosticLocation(raw));
  return [location, code, message].filter((part) => part !== undefined && part !== '').join(' ');
}

/**
 * The finding the CLI prints under the error, one per source diagnostic. The
 * terminal renderer prints a finding's code and summary and nothing of its
 * `where`, so the summary starts with the location. A source code that is not
 * yet dotted is wrapped as `CONTRACT.SOURCE_DIAGNOSTIC` and named in the summary.
 */
function sourceDiagnosticToFinding(
  raw: unknown,
  severity: Diagnostic['severity'],
  cwd: string | undefined,
): Diagnostic | undefined {
  if (!isRecord(raw)) return undefined;
  const code = typeof raw['code'] === 'string' ? raw['code'] : 'diagnostic';
  const message = typeof raw['message'] === 'string' ? raw['message'] : '';
  const location = displayLocation(diagnosticLocation(raw), cwd);
  const formatted = formatLocation(location);
  const locatedSummary = (text: string) =>
    formatted === undefined ? text : `${formatted} ${text}`;
  const finding = {
    severity,
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

function sourceDiagnosticsToFindings(
  diagnostics: readonly unknown[],
  cwd: string | undefined,
): Diagnostic[] {
  const findings: Diagnostic[] = [];
  for (const raw of diagnostics) {
    const finding = sourceDiagnosticToFinding(raw, 'error', cwd);
    if (finding !== undefined) findings.push(finding);
  }
  return findings;
}

/**
 * A warning the contract source reported, as a `warn` diagnostic of the command's result: its summary starts with the location, `where` names the file and line, and `meta` keeps the source's own code and its span, which carries the column.
 */
export function sourceWarningDiagnostic(
  raw: ContractSourceDiagnostic,
  cwd: string,
): Diagnostic | undefined {
  const finding = sourceDiagnosticToFinding(raw, 'warn', cwd);
  if (finding === undefined) return undefined;
  return {
    ...finding,
    meta: { ...finding.meta, ...ifDefined('span', raw.span) },
  };
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
  cwd: string | undefined,
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
      sourceDiagnosticsToFindings(failure['diagnostics'], cwd),
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
export async function loadContractSourceWithStack(inputs: {
  readonly stack: ControlStack;
  readonly source: ContractSourceProvider;
  readonly signal?: AbortSignal;
  readonly reportWarning?: (diagnostic: ContractSourceDiagnostic) => void;
  /** The directory the returned error shows locations relative to; `undefined` shows a source's paths as it gave them. */
  readonly cwd: string | undefined;
}): Promise<ContractSourceLoadResult> {
  const { stack, source } = inputs;
  const signal = inputs.signal ?? new AbortController().signal;
  const unlessAborted = abortable(signal);

  const sourceContext = {
    ...ifDefined('reportWarning', inputs.reportWarning),
    composedExtensions: stack.extensions.map((p) => p.id),
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    ...ifDefined('pslDiagnostics', stack.family?.pslDiagnostics),
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    dataTypes: stack.dataTypes,
    resolvedInputs: await unlessAborted(expandContractInputs(source.inputs)),
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

  return validateProviderResult(providerResult, inputs.cwd);
}

type ContractConfig = NonNullable<PrismaNextConfig['contract']>;

/** @throws {CliStructuredError} `CONFIG.CONTRACT_MISSING` when the config has no contract section */
export function requireContractConfig(config: PrismaNextConfig): ContractConfig {
  if (!config.contract) {
    throw errorContractConfigMissing({
      why: 'Config.contract is required for emit. Define it in your config: contract: { source: ..., output: ... }',
    });
  }
  return config.contract;
}

/** @throws {CliStructuredError} `CONFIG.CONTRACT_MISSING` when the contract source has no `load` function */
export function requireSourceProvider(contractConfig: ContractConfig): void {
  if (typeof contractConfig.source?.load !== 'function') {
    throw errorContractConfigMissing({
      why: 'Contract config must include a valid source provider object',
    });
  }
}

/** What a contract source reported when it could not produce a contract. */
export interface ContractSourceFailure {
  readonly summary: string;
  readonly diagnostics: readonly unknown[];
  readonly meta: unknown;
}

/**
 * Runs the config's contract source and stops there: nothing is emitted or
 * written. A source that reports diagnostics is a `notOk` carrying them.
 *
 * @throws {CliStructuredError} the error `contract emit` raises, when the
 * config has no contract source or the source is malformed or throws
 * @throws {DOMException} `AbortError` if cancelled via `signal`
 */
export async function loadContractSource(
  config: PrismaNextConfig,
  options: {
    readonly signal?: AbortSignal;
    /** Receives each warning the source reports. */
    readonly onWarning?: (diagnostic: ContractSourceDiagnostic) => void;
  } = {},
): Promise<Result<Contract, ContractSourceFailure>> {
  const contractConfig = requireContractConfig(config);
  requireSourceProvider(contractConfig);
  const loaded = await loadContractSourceWithStack({
    stack: createControlStack(config),
    source: contractConfig.source,
    cwd: undefined,
    ...ifDefined('signal', options.signal),
    ...ifDefined('reportWarning', options.onWarning),
  });
  if (loaded.ok) return loaded;
  const { error, sourceDiagnostics } = loaded.failure;
  if (sourceDiagnostics === undefined) throw error;
  return notOk({
    summary: sourceDiagnostics.summary,
    diagnostics: sourceDiagnostics.diagnostics,
    meta: sourceDiagnostics.meta,
  });
}
