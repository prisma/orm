import { mkdir } from 'node:fs/promises';
import type { Contract } from '@internal/contract/types';
import { emit, getEmittedArtifactPaths } from '@internal/emitter';
import { createControlStack } from '@internal/framework-components/control';
import { abortable } from '@internal/utils/abortable';
import { ifDefined } from '@internal/utils/defined';
import type { JsonObject } from '@internal/utils/json';
import { dirname, join } from 'pathe';
import { errorContractConfigMissing, errorRuntime } from '../../utils/cli-errors';
import { queueEmitByOutput } from '../../utils/emit-queue';
import { assertFrameworkComponentsCompatible } from '../../utils/framework-components';
import { createProjectSpecifierResolver } from '../../utils/project-import-root';
import { publishContractArtifactPair } from '../../utils/publish-contract-artifact-pair';
import { validateContractDeps } from '../../utils/validate-contract-deps';
import { enrichContract } from '../contract-enrichment';
import type {
  ContractEmitOptions,
  ContractEmitResult,
  ControlActionName,
  OnControlProgress,
} from '../types';

const EMIT_ACTION: ControlActionName = 'emit';

type ContractEmitDependencies = {
  readonly emit: typeof emit;
};

const defaultContractEmitDependencies: ContractEmitDependencies = { emit };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function startSpan(onProgress: OnControlProgress | undefined, spanId: string, label: string): void {
  onProgress?.({ action: EMIT_ACTION, kind: 'spanStart', spanId, label });
}

function endSpan(
  onProgress: OnControlProgress | undefined,
  spanId: string,
  outcome: 'ok' | 'error',
): void {
  onProgress?.({ action: EMIT_ACTION, kind: 'spanEnd', spanId, outcome });
}

function failedToResolveContractSource(
  why: string,
  fix: string,
  meta?: Record<string, unknown>,
  cause?: unknown,
) {
  return errorRuntime('CONTRACT.SOURCE_LOAD_FAILED', 'Failed to resolve contract source', {
    why,
    fix,
    ...ifDefined('meta', meta),
    ...ifDefined('cause', cause),
  });
}

type ValidatedProviderResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: ReturnType<typeof errorRuntime> };

function diagnosticLocationSuffix(diagnostic: Record<string, unknown>): string {
  const sourceId = typeof diagnostic['sourceId'] === 'string' ? diagnostic['sourceId'] : undefined;
  const span = isRecord(diagnostic['span']) ? diagnostic['span'] : undefined;
  const start = span && isRecord(span['start']) ? span['start'] : undefined;
  const line = start && typeof start['line'] === 'number' ? start['line'] : undefined;
  const column = start && typeof start['column'] === 'number' ? start['column'] : undefined;
  if (sourceId && line !== undefined && column !== undefined) {
    return ` (${sourceId}:${line}:${column})`;
  }
  if (sourceId) {
    return ` (${sourceId})`;
  }
  return '';
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
    if (!('value' in providerResult)) {
      return {
        ok: false,
        error: failedToResolveContractSource(
          'Contract source provider returned malformed success result: missing value.',
          'Ensure contract.source.load success payload is ok(Contract).',
        ),
      };
    }
    return { ok: true, value: providerResult['value'] };
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
  const issues = mapDiagnosticsToIssues(failure['diagnostics']);
  const summary = String(failure['summary']);
  const why = [summary, ...issues.map((issue) => `  - ${issue.message}`)].join('\n');
  return {
    ok: false,
    error: failedToResolveContractSource(
      why,
      'Fix contract source diagnostics and return ok(Contract).',
      {
        diagnostics: failure['diagnostics'],
        issues,
        ...ifDefined('providerMeta', failure['meta']),
      },
    ),
  };
}

/**
 * Canonical contract emit operation.
 *
 * This is the SINGLE publication path used by both the CLI command
 * (`prisma contract emit`) and the Vite plugin
 * (`@internal/vite-plugin-contract-emit`). New callers must go through this
 * function rather than re-implementing load → emit → publish.
 *
 * The whole flow (load config → resolve source → emit bytes → atomic publish)
 * is serialized per output JSON path via `queueEmitByOutput`. Concurrent calls
 * for the same output line up FIFO; the user-visible outcome is "last
 * submission wins on disk" without any supersession bookkeeping. Within a
 * single emit, `publishContractArtifactPair` stages temp files, renames
 * `contract.d.ts` before `contract.json`, and attempts to restore the previous
 * pair if either rename fails — so type-only consumers never observe a
 * mismatched pair.
 *
 * @throws {CliStructuredError} on config/source/validation problems
 * @throws {DOMException} `AbortError` if cancelled via `signal`
 */
export async function executeContractEmit(
  options: ContractEmitOptions,
  dependencies: ContractEmitDependencies = defaultContractEmitDependencies,
): Promise<ContractEmitResult> {
  const {
    config,
    configPath,
    outputPath,
    signal = new AbortController().signal,
    onProgress,
  } = options;
  const unlessAborted = abortable(signal);

  if (!config.contract) {
    throw errorContractConfigMissing({
      why: 'Config.contract is required for emit. Define it in your config: contract: { source: ..., output: ... }',
    });
  }

  const contractConfig = config.contract;

  const effectiveOutput =
    outputPath !== undefined ? join(outputPath, 'contract.json') : contractConfig.output;

  if (!effectiveOutput) {
    throw errorContractConfigMissing({
      why: 'Contract config must have output path. This should not happen if defineConfig() was used.',
    });
  }

  if (typeof contractConfig.source?.load !== 'function') {
    throw errorContractConfigMissing({
      why: 'Contract config must include a valid source provider object',
    });
  }

  let outputPaths: ReturnType<typeof getEmittedArtifactPaths>;
  try {
    outputPaths = getEmittedArtifactPaths(effectiveOutput);
  } catch (error) {
    throw errorContractConfigMissing({
      why: error instanceof Error ? error.message : String(error),
    });
  }
  const { jsonPath: outputJsonPath, dtsPath: outputDtsPath } = outputPaths;

  return queueEmitByOutput(outputJsonPath, async () => {
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

    startSpan(onProgress, 'resolveSource', 'Resolving contract source...');
    let providerResult: Awaited<ReturnType<typeof contractConfig.source.load>>;
    try {
      providerResult = await unlessAborted(contractConfig.source.load(sourceContext));
    } catch (error) {
      endSpan(onProgress, 'resolveSource', 'error');
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

    const validatedContract = validateProviderResult(providerResult);
    if (!validatedContract.ok) {
      endSpan(onProgress, 'resolveSource', 'error');
      throw validatedContract.error;
    }
    endSpan(onProgress, 'resolveSource', 'ok');

    startSpan(onProgress, 'emit', 'Emitting contract...');
    let emitResult: Awaited<ReturnType<typeof emit>>;
    try {
      const familyInstance = config.family.create(stack);
      const rawComponents = [config.target, config.adapter, ...(config.extensions ?? [])];
      const frameworkComponents = assertFrameworkComponentsCompatible(
        config.family.familyId,
        config.target.targetId,
        rawComponents,
      );
      // Blind cast: `validateProviderResult` upstream has already
      // pinned `validatedContract.value` to the provider's loose
      // `Contract` envelope, but the local `Contract` type at this
      // call site is the precise structural interface. The cast just
      // defers the structural check by one statement so `enrichContract`
      // can decorate first; the subsequent serialize→deserialize round-trip
      // re-narrows the envelope into the precise type.
      const enrichedIR = enrichContract(
        validatedContract.value as unknown as Contract,
        frameworkComponents,
      );
      const rawContractJson = config.target.contractSerializer.serializeContract(enrichedIR);
      const deserializedContract = familyInstance.deserializeContract(rawContractJson);
      // Each target's descriptor ships a `contractSerializer` SPI; the
      // framework canonicalizer threads its `serializeContract` so the
      // on-disk JSON envelope is constructed by target-owned code
      // rather than by walking the in-memory contract with
      // `Object.entries` (which would leak runtime-only class API
      // fields into the persisted shape). The optional `shouldPreserveEmpty`
      // and `sortStorage` hooks let the family contribute storage-specific
      // canonicalization rules without the framework importing family code.
      const { contractSerializer } = config.target;
      const serializeContract = (c: Contract): JsonObject =>
        contractSerializer.serializeContract(c);
      emitResult = await unlessAborted(
        dependencies.emit(deserializedContract, stack, config.family.emission, {
          outputJsonPath,
          serializeContract,
          // Which package names the generated files may import is decided by
          // the nearest manifest above the file being written — the package
          // that will import it, and the same directory `validateContractDeps`
          // resolves against below. A caller holding the config file's path
          // may name it instead.
          resolveImportSpecifier: createProjectSpecifierResolver(configPath ?? outputJsonPath),
          ...ifDefined('shouldPreserveEmpty', contractSerializer.shouldPreserveEmpty),
          ...ifDefined('sortStorage', contractSerializer.sortStorage),
          ...ifDefined('supportsNamespaces', config.target.supportsNamespaces),
        }),
      );
    } catch (error) {
      endSpan(onProgress, 'emit', 'error');
      throw error;
    }
    endSpan(onProgress, 'emit', 'ok');

    await unlessAborted(mkdir(dirname(outputJsonPath), { recursive: true }));
    await publishContractArtifactPair({
      outputJsonPath,
      outputDtsPath,
      contractJson: emitResult.contractJson,
      contractDts: emitResult.contractDts,
      publicationToken: String(process.hrtime.bigint()),
    });

    const validationWarning = validateContractDeps(
      emitResult.contractDts,
      dirname(outputDtsPath),
    ).warning;

    return {
      storageHash: emitResult.storageHash,
      ...ifDefined('executionHash', emitResult.executionHash),
      profileHash: emitResult.profileHash,
      files: {
        json: outputJsonPath,
        dts: outputDtsPath,
      },
      ...ifDefined('validationWarning', validationWarning),
    };
  });
}
