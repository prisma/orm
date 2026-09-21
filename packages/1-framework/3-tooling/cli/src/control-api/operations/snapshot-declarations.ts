import type { ImportSpecifierResolver } from '@internal/framework-components/emission';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { CliStructuredError, errorContractValidationFailed } from '../../utils/cli-errors';
import type { RenderContractDtsFailure } from '../render-contract-dts';
import type { ControlClient } from '../types';

function errorContractDtsRenderFailed(
  contractJsonPath: string,
  failure: RenderContractDtsFailure,
): CliStructuredError {
  const why = failure.why ?? failure.summary;
  if (failure.code === 'CONTRACT_VALIDATION_FAILED') {
    return errorContractValidationFailed(
      `Contract at ${contractJsonPath} failed to deserialize: ${why}`,
      { where: { path: contractJsonPath }, ...ifDefined('cause', failure.cause) },
    );
  }
  return new CliStructuredError('CONTRACT.TYPES_RENDER_FAILED', 'Failed to render contract types', {
    why: `The types for the contract at ${contractJsonPath} could not be rendered: ${why}`,
    fix: 'Run {bin} contract emit to see why the contract does not emit, fix it, then run the command again.',
    where: { path: contractJsonPath },
    ...ifDefined('cause', failure.cause),
  });
}

/**
 * The `contract.d.ts` half of a snapshot, rendered from the `contract.json`
 * half through the control client. Every snapshot writer renders before it
 * writes anything, so a contract that cannot be snapshotted refuses the
 * command with nothing on disk changed.
 */
export async function renderSnapshotDeclarations(args: {
  readonly client: Pick<ControlClient, 'renderContractDts'>;
  readonly contractJson: unknown;
  readonly contractJsonPath: string;
  readonly resolveImportSpecifier: ImportSpecifierResolver;
}): Promise<Result<string, CliStructuredError>> {
  const rendered = await args.client.renderContractDts({
    contract: args.contractJson,
    resolveImportSpecifier: args.resolveImportSpecifier,
  });
  if (!rendered.ok) {
    return notOk(errorContractDtsRenderFailed(args.contractJsonPath, rendered.failure));
  }
  return ok(rendered.value.contractDts);
}
