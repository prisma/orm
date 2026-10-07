import { dataType } from '@internal/framework-components/codec';
import type { ExtensionPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../../src/exports/contract-builder';

const duplicateText: ExtensionPackRef<'sql', 'postgres'> = {
  kind: 'extension',
  id: 'duplicate-text',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  dataTypes: [dataType('pg/text', {})],
};

describe('postgres defineContract data types', () => {
  it('refuses an extension that registers a data type the target already registers', () => {
    expect(() => defineContract({ extensions: { duplicateText } })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DATA_TYPE_DUPLICATE',
        details: expect.objectContaining({ dataType: 'pg/text', contributedBy: 'duplicate-text' }),
      }),
    );
  });
});
