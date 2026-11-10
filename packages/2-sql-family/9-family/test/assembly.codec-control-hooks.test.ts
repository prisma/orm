import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { extractCodecControlHooks } from '../src/core/assembly';
import type { CodecControlHooks } from '../src/exports/control';

describe('extractCodecControlHooks', () => {
  const hooks: CodecControlHooks = {
    planTypeOperations: (_options) => ({ operations: [] }),
  };

  function createComponent(id: string): TargetBoundComponentDescriptor<'sql', 'postgres'> {
    return {
      kind: 'adapter',
      id,
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.0-test',
      types: {
        codecTypes: {
          controlPlaneHooks: {
            'test/enum@1': hooks,
          },
        },
      },
    } as TargetBoundComponentDescriptor<'sql', 'postgres'>;
  }

  it('collects control hooks by codecId', () => {
    const map = extractCodecControlHooks([createComponent('one')]);

    expect(map.get('test/enum@1')).toBe(hooks);
  });

  it('throws on duplicate codecId ownership', () => {
    expect(() =>
      extractCodecControlHooks([createComponent('one'), createComponent('two')]),
    ).toThrow('Duplicate control hooks for codecId');
  });
});
