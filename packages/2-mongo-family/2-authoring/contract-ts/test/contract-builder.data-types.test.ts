import { dataType } from '@internal/framework-components/codec';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';

const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'mongo'>;

const mongoTargetPack = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
  dataTypes: [dataType('mongo/string', { read: (json) => json })],
} as const satisfies TargetPackRef<'mongo', 'mongo'>;

const duplicateString = {
  kind: 'extension',
  id: 'duplicate-string',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  dataTypes: [dataType('mongo/string', { read: (json) => json })],
} as const satisfies ExtensionPackRef<'mongo', 'mongo'>;

describe('mongo defineContract data types', () => {
  it('refuses an extension that registers a data type the target already registers', () => {
    expect(() =>
      defineContract(
        { family: mongoFamilyPack, target: mongoTargetPack, extensions: { duplicateString } },
        () => ({ models: {} }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DATA_TYPE_DUPLICATE',
        details: expect.objectContaining({
          dataType: 'mongo/string',
          contributedBy: 'duplicate-string',
        }),
      }),
    );
  });
});
