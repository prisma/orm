import type { ComponentMetadata } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { restateTypeDeclarations } from '../src/restate-type-declarations';

const MODULE = '@acme/orm-db/generated-types';

describe('restateTypeDeclarations', () => {
  it('names the given module in every type declaration, keeping each name and alias', () => {
    const codecDescriptors: readonly never[] = [];
    const create = () => ({});
    const descriptor = {
      kind: 'adapter',
      id: 'postgres',
      create,
      types: {
        aggregateDescriptors: [],
        codecTypes: {
          codecDescriptors,
          import: { package: '@acme/target/codec-types', named: 'CodecTypes', alias: 'PgTypes' },
          typeImports: [
            { package: '@acme/target/codec-types', named: 'JsonValue', alias: 'JsonValue' },
          ],
          parameterizedOutputTypes: {
            package: '@acme/target/codec-types',
            named: 'ParameterizedOutputTypesForTypeParams',
            alias: 'PgParameterizedOutputTypes',
          },
        },
        queryOperationTypes: {
          import: {
            package: '@acme/target/operation-types',
            named: 'QueryOperationTypes',
            alias: 'Q',
          },
        },
      },
    };

    const restated = restateTypeDeclarations(descriptor, MODULE);

    expect(restated).toEqual({
      kind: 'adapter',
      id: 'postgres',
      create,
      types: {
        aggregateDescriptors: [],
        codecTypes: {
          codecDescriptors,
          import: { package: MODULE, named: 'CodecTypes', alias: 'PgTypes' },
          typeImports: [{ package: MODULE, named: 'JsonValue', alias: 'JsonValue' }],
          parameterizedOutputTypes: {
            package: MODULE,
            named: 'ParameterizedOutputTypesForTypeParams',
            alias: 'PgParameterizedOutputTypes',
          },
        },
        queryOperationTypes: {
          import: { package: MODULE, named: 'QueryOperationTypes', alias: 'Q' },
        },
      },
    });
    expect(restated.create).toBe(create);
    expect(restated.types.codecTypes.codecDescriptors).toBe(codecDescriptors);
    expect(descriptor.types.codecTypes.import.package).toBe('@acme/target/codec-types');
  });

  it('restates the query operation types of a target that declares only those', () => {
    const codecTypes = { codecDescriptors: [] };
    const descriptor = {
      kind: 'target',
      id: 'postgres',
      types: {
        codecTypes,
        queryOperationTypes: {
          import: {
            package: '@acme/target/operation-types',
            named: 'QueryOperationTypes',
            alias: 'Q',
          },
        },
      },
    };

    expect(restateTypeDeclarations(descriptor, MODULE).types).toEqual({
      codecTypes,
      queryOperationTypes: {
        import: { package: MODULE, named: 'QueryOperationTypes', alias: 'Q' },
      },
    });
  });

  it('returns a descriptor that declares no types as it is', () => {
    const descriptor = {
      kind: 'target',
      id: 'sqlite',
      types: { codecTypes: { codecDescriptors: [] } },
    };

    expect(restateTypeDeclarations(descriptor, MODULE)).toBe(descriptor);
  });

  it('returns a descriptor with no type metadata as it is', () => {
    const descriptor: Pick<ComponentMetadata, 'types'> & { readonly kind: string } = {
      kind: 'driver',
    };

    expect(restateTypeDeclarations(descriptor, MODULE)).toBe(descriptor);
  });
});
