import type { ApplicationDomain } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { domainElementCoordinates } from '../src/ir/domain';

describe('domainElementCoordinates', () => {
  it('yields domain-plane coordinates for models and enums', () => {
    const domain: Pick<ApplicationDomain, 'namespaces'> = {
      namespaces: {
        auth: {
          models: { User: { fields: {}, relations: {}, storage: {} } },
          enum: { Role: { codecId: 'pg/text@1', members: [{ name: 'Admin', value: 'admin' }] } },
        },
        public: {
          models: { Post: { fields: {}, relations: {}, storage: {} } },
        },
      },
    };

    const coordinates = [...domainElementCoordinates(domain)];

    expect(coordinates).toEqual(
      expect.arrayContaining([
        { plane: 'domain', namespaceId: 'auth', entityKind: 'models', entityName: 'User' },
        { plane: 'domain', namespaceId: 'auth', entityKind: 'enum', entityName: 'Role' },
        { plane: 'domain', namespaceId: 'public', entityKind: 'models', entityName: 'Post' },
      ]),
    );
    expect(coordinates).toHaveLength(3);
  });
});
