import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import type { ApplicationDomain } from '../src/domain-envelope';
import type { ContractModelBase } from '../src/domain-types';
import { resolveDomainModel } from '../src/resolve-domain-model';
import { applicationDomainOf } from './support/application-domain-of';

function minimalModel(name: string): ContractModelBase {
  return blindCast<ContractModelBase, 'minimal model fixture for resolveDomainModel tests'>({
    name,
    fields: {},
    relations: {},
    storage: {},
  });
}

function multiNamespaceDomain(
  namespaces: Record<string, Record<string, ContractModelBase>>,
): ApplicationDomain {
  return blindCast<
    ApplicationDomain,
    'multi-namespace domain fixture for resolveDomainModel tests'
  >({
    namespaces: Object.fromEntries(
      Object.entries(namespaces).map(([namespaceId, models]) => [namespaceId, { models }]),
    ),
  });
}

describe('resolveDomainModel', () => {
  it('finds a model in whichever namespace declares it', () => {
    const authUser = minimalModel('User');
    const domain = multiNamespaceDomain({
      public: {},
      auth: { User: authUser },
    });

    const resolved = resolveDomainModel(domain, 'User');

    expect(resolved).toEqual({ namespaceId: 'auth', model: authUser });
  });

  it('resolves within a single-namespace contract', () => {
    const user = minimalModel('User');
    const domain = applicationDomainOf({ models: { User: user } });

    const resolved = resolveDomainModel(domain, 'User');

    expect(resolved?.namespaceId).toBe('__unbound__');
    expect(resolved?.model).toBe(user);
  });

  it('returns undefined when no namespace declares the model name', () => {
    const domain = applicationDomainOf({ models: {} });

    expect(resolveDomainModel(domain, 'Missing')).toBeUndefined();
  });

  it('finds no model for a name every object has as a property', () => {
    const domain = multiNamespaceDomain({ public: { User: minimalModel('User') } });

    expect(resolveDomainModel(domain, 'constructor')).toBeUndefined();
  });
});
