import { mkdir } from 'node:fs/promises';
import type { Contract } from '@internal/contract/types';
import { emit, getEmittedArtifactPaths } from '@internal/emitter';
import { type ControlStack, createControlStack } from '@internal/framework-components/control';
import { abortable } from '@internal/utils/abortable';
import { ifDefined } from '@internal/utils/defined';
import type { JsonObject } from '@internal/utils/json';
import { dirname, join } from 'pathe';
import { errorContractConfigMissing } from '../../utils/cli-errors';
import { queueEmitByOutput } from '../../utils/emit-queue';
import { createProjectSpecifierResolver } from '../../utils/project-import-root';
import { publishContractArtifactPair } from '../../utils/publish-contract-artifact-pair';
import { validateContractDeps } from '../../utils/validate-contract-deps';
import type {
  ContractEmitOptions,
  ContractEmitResult,
  ControlActionName,
  OnControlProgress,
} from '../types';
import {
  requireContractConfig,
  requireSourceProvider,
  resolveContractSource,
} from './load-contract-source';
import { validateLoadedContract } from './validate-loaded-contract';

const EMIT_ACTION: ControlActionName = 'emit';

type ContractEmitDependencies = {
  readonly emit: typeof emit;
};

const defaultContractEmitDependencies: ContractEmitDependencies = { emit };

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
    projectDir,
    outputPath,
    signal = new AbortController().signal,
    onProgress,
  } = options;
  const unlessAborted = abortable(signal);
  const contractConfig = requireContractConfig(config);

  const effectiveOutput =
    outputPath !== undefined ? join(outputPath, 'contract.json') : contractConfig.output;

  if (!effectiveOutput) {
    throw errorContractConfigMissing({
      why: 'Contract config must have output path. This should not happen if defineConfig() was used.',
    });
  }

  requireSourceProvider(contractConfig);

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
    startSpan(onProgress, 'resolveSource', 'Resolving contract source...');
    let stack: ControlStack;
    let contract: Contract;
    try {
      stack = createControlStack(config);
      const loaded = await resolveContractSource({ stack, source: contractConfig.source, signal });
      if (!loaded.ok) throw loaded.failure.error;
      contract = loaded.value;
    } catch (error) {
      endSpan(onProgress, 'resolveSource', 'error');
      throw error;
    }
    endSpan(onProgress, 'resolveSource', 'ok');

    startSpan(onProgress, 'emit', 'Emitting contract...');
    let emitResult: Awaited<ReturnType<typeof emit>>;
    try {
      const familyInstance = config.family.create(stack);
      const deserializedContract = validateLoadedContract({ config, familyInstance, contract });
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
          deserializeContract: (json) => familyInstance.deserializeContract(json),
          // Which package names the generated files may import is decided by
          // the nearest manifest above the file being written — the package
          // that will import it, and the same directory `validateContractDeps`
          // resolves against below. A caller that knows the project directory
          // names it instead.
          resolveImportSpecifier: createProjectSpecifierResolver(
            projectDir ?? dirname(outputJsonPath),
          ),
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
