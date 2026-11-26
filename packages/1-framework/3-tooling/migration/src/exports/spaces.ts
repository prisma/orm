export {
  type ApplyInstalledContractSpaceInputs,
  applyInstalledContractSpace,
  type InstalledContractSpaceApplied,
} from '../apply-installed-contract-space';
export {
  assertDescriptorSelfConsistency,
  type DescriptorSelfConsistencyInputs,
} from '../assert-descriptor-self-consistency';
export {
  type ComputeExtensionSpaceApplyPathInputs,
  computeExtensionSpaceApplyPath,
  type ExtensionSpaceApplyPathOutcome,
} from '../compute-extension-space-apply-path';
export type { SpaceApplyInput } from '../concatenate-space-apply-inputs';
export { contractSpaceFromJson } from '../contract-space-from-json';
export {
  type ContractSpaceArtifactInputs,
  emitContractSpaceArtifacts,
} from '../emit-contract-space-artifacts';
export {
  type DiskContractSpaceState,
  gatherDiskContractSpaceState,
} from '../gather-disk-contract-space-state';
export {
  planAllSpaces,
  type SpacePlanInput,
  type SpacePlanOutput,
} from '../plan-all-spaces';
export {
  type ContractSpaceHeadRef,
  readContractSpaceHeadRef,
} from '../read-contract-space-head-ref';
export {
  APP_SPACE_ID,
  assertValidSpaceId,
  isValidSpaceId,
  RESERVED_SPACE_SUBDIR_NAMES,
  SPACE_REFS_DIRNAME,
  spaceMigrationDirectory,
  spaceRefsDirectory,
  type ValidSpaceId,
} from '../space-layout';
export {
  type ContractSpaceHeadRecord,
  listContractSpaceDirectories,
  type SpaceMarkerRecord,
  type SpaceVerifierViolation,
  type VerifyContractSpacesInputs,
  type VerifyContractSpacesResult,
  verifyContractSpaces,
} from '../verify-contract-spaces';
