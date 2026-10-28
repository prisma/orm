import { describe, expect, it } from 'vitest';
import {
  assertSafeAuthoringHelperKey,
  composePackAuthoringNamespace,
} from '../src/pack-authoring-namespaces';

const textConstructor = {
  kind: 'typeConstructor',
  output: { codecId: 'test/text@1' },
} as const;

describe('composePackAuthoringNamespace', () => {
  it('merges one namespace across packs and ignores packs without it', () => {
    const merged = composePackAuthoringNamespace(
      [
        { authoring: { type: { audit: { Text: textConstructor } } } },
        {},
        { authoring: { type: { audit: { Note: textConstructor } } } },
      ],
      'type',
    );
    expect(merged).toEqual({ audit: { Text: textConstructor, Note: textConstructor } });
  });

  it('rejects the same helper path from two packs', () => {
    expect(() =>
      composePackAuthoringNamespace(
        [
          { authoring: { type: { audit: { Text: textConstructor } } } },
          { authoring: { type: { audit: { Text: textConstructor } } } },
        ],
        'type',
      ),
    ).toThrow(/audit\.Text/);
  });

  it('refuses a pack that contributes authoring.field, naming typeAlias as the replacement', () => {
    expect(() =>
      composePackAuthoringNamespace(
        [
          { id: 'base-pack', authoring: { type: { Text: textConstructor } } },
          { id: 'legacy-pack', authoring: { field: {} } as unknown as never },
        ],
        'type',
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Component "legacy-pack" contributes authoring.field, which Prisma 8 removed with field presets. Contribute a type alias (kind: \'typeAlias\') or a type constructor in authoring.type.',
      }),
    );
  });
});

describe('assertSafeAuthoringHelperKey', () => {
  it.each(['__proto__', 'constructor', 'prototype'])(
    'refuses the helper path segment %s',
    (key) => {
      expect(() => assertSafeAuthoringHelperKey(key, ['audit'])).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
          message: `Invalid authoring helper "audit.${key}". Helper path segments must not use "${key}".`,
          meta: { helperPath: `audit.${key}`, segment: key },
        }),
      );
    },
  );

  it('accepts any other segment', () => {
    expect(() => assertSafeAuthoringHelperKey('Text', ['audit'])).not.toThrow();
  });
});
