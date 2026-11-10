import { sqlRuntimeFamilyDescriptor } from '../core/runtime-descriptor';

export {
  type ResolvedDomainModel,
  type ResolvedStorageTable,
  resolveDomainModel,
  resolveStorageTable,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '../core/default-namespace';
export { timestampNowRuntimeGenerator } from '../core/timestamp-now-runtime-generator';

export default sqlRuntimeFamilyDescriptor;
