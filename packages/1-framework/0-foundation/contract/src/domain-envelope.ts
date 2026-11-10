import type { ContractEnum, ContractModelBase } from './domain-types';
import type { StorageBase } from './types';

export { UNBOUND_DOMAIN_NAMESPACE_ID } from './default-namespace';

/**
 * One namespace's application-domain entities — models and optional enums
 * keyed by entity name within that namespace coordinate. Value objects are
 * storage entities (ADR 309).
 */
export interface ApplicationDomainNamespace {
  readonly models: Record<string, ContractModelBase>;
  readonly enum?: Record<string, ContractEnum>;
}

/**
 * Application-domain envelope: entity content keyed by namespace id.
 * Mirrors the storage plane's `namespaces` segment (ADR 221).
 */
export interface ApplicationDomain {
  readonly namespaces: Readonly<Record<string, ApplicationDomainNamespace>>;
}

/**
 * What reading a contract's domain fields needs: the domain, and the storage namespaces that hold the value objects its fields refer to (ADR 309).
 */
export type ContractWithDomain = {
  readonly domain: ApplicationDomain;
  readonly storage: Pick<StorageBase, 'namespaces'>;
};
