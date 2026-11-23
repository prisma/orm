import type { DBAdapterSchemaCreation } from '@better-auth/core/db/adapter';
import type { ContractComparison } from '../contract/compare';
import { contractSourceFiles } from './contract-source-files';
import { editContractSource } from './edit-contract-source';
import { assertOnlyAdditions } from './refusal';

/**
 * What `auth generate` writes when the contract lacks models or fields: the whole edited contract file, for Better Auth to overwrite after it asks. Prints one line saying what is added. Throws the contract message when the contract cannot be edited.
 */
export async function contractSchemaCreation(
  file: string | undefined,
  comparison: ContractComparison,
): Promise<DBAdapterSchemaCreation> {
  assertOnlyAdditions(comparison);
  const edit = editContractSource(await contractSourceFiles(file, comparison), comparison);
  console.log(edit.summary);
  return { code: edit.code, path: edit.path, overwrite: true };
}
