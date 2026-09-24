import type { AuthoringFieldNamespace } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import {
  composePackAuthoringNamespace,
  createFieldHelpersFromNamespace,
} from '../src/field-preset-helpers';

const createdAtPreset = {
  kind: 'fieldPreset',
  output: { codecId: 'test/timestamp@1', nativeType: 'timestamp' },
} as const;

const nestedFieldNamespace = {
  audit: {
    createdAt: createdAtPreset,
  },
} as const satisfies AuthoringFieldNamespace;

function withBlockedKey<T extends object>(value: T): T {
  const unsafe = Object.create(null) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(value)) {
    unsafe[key] = entry;
  }
  Object.defineProperty(unsafe, '__proto__', {
    enumerable: true,
    value: value,
  });
  return unsafe as T;
}

describe('createFieldHelpersFromNamespace', () => {
  it('creates nested field helpers and passes the resolved helper path to leaf factories', () => {
    const helpers = createFieldHelpersFromNamespace(
      nestedFieldNamespace,
      ({ helperPath }) =>
        () =>
          helperPath,
    ) as {
      readonly audit: {
        readonly createdAt: () => string;
      };
    };

    expect(helpers.audit.createdAt()).toBe('audit.createdAt');
  });

  it('rejects blocked path segments when building field helpers', () => {
    const unsafeNamespace = {
      nested: withBlockedKey({
        createdAt: createdAtPreset,
      }),
    } as unknown as AuthoringFieldNamespace;

    expect(() =>
      createFieldHelpersFromNamespace(
        unsafeNamespace,
        ({ helperPath }) =>
          () =>
            helperPath,
      ),
    ).toThrow(
      'Invalid authoring helper "nested.__proto__". Helper path segments must not use "__proto__".',
    );
  });
});

describe('composePackAuthoringNamespace', () => {
  it('merges one namespace across packs and ignores packs without it', () => {
    const merged = composePackAuthoringNamespace(
      [
        { authoring: { field: { audit: { createdAt: createdAtPreset } } } },
        {},
        { authoring: { field: { audit: { updatedAt: createdAtPreset } } } },
      ],
      'field',
    );
    expect(merged).toEqual({ audit: { createdAt: createdAtPreset, updatedAt: createdAtPreset } });
  });

  it('rejects the same helper path from two packs', () => {
    expect(() =>
      composePackAuthoringNamespace(
        [
          { authoring: { field: { audit: { createdAt: createdAtPreset } } } },
          { authoring: { field: { audit: { createdAt: createdAtPreset } } } },
        ],
        'field',
      ),
    ).toThrow(/audit\.createdAt/);
  });
});
