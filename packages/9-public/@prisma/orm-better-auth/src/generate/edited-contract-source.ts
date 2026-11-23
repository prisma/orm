import type { DBAdapterSchemaCreation } from '@better-auth/core/db/adapter';
import { BetterAuthError } from '@better-auth/core/error';
import type { ContractComparison } from '../contract/compare';
import { contractSourceFiles } from './contract-source-files';
import { editContractSource } from './edit-contract-source';
import { assertOnlyAdditions } from './refusal';

/**
 * What `auth generate` writes when the contract lacks models or fields: the whole edited contract file at its absolute path, for Better Auth to overwrite after it asks. Prints what is added. Throws the contract message when the contract cannot be edited.
 */
export async function editedContractSource(
  file: string | undefined,
  comparison: ContractComparison,
): Promise<DBAdapterSchemaCreation> {
  assertOnlyAdditions(comparison);
  const files = await contractSourceFiles(file, comparison);
  const edit = editContractSource(files, comparison);
  const edited = files.find((candidate) => candidate.path === edit.path);
  if (edited === undefined)
    throw new BetterAuthError(`The edit names ${edit.path}, which was not read`);
  console.log(edit.summary);
  return { code: edit.code, path: edited.absolutePath, overwrite: true };
}
