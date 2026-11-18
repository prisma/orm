import type { ExtensionPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { composedExtensionPackRefs } from '../src/composed-extension-pack-refs';

const target: Pick<TargetPackRef<'sql', string>, 'familyId' | 'targetId'> = {
  familyId: 'sql',
  targetId: 'postgres',
};

describe('composedExtensionPackRefs', () => {
  it('gives nothing when no extension pack is composed', () => {
    expect(composedExtensionPackRefs(target, [])).toBeUndefined();
  });

  it('records each composed pack by id, sorted, with a ref built from the target', () => {
    const refs = composedExtensionPackRefs(target, ['pgvector', 'citext']);

    expect(refs).toEqual({
      citext: {
        kind: 'extension',
        id: 'citext',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
      },
      pgvector: {
        kind: 'extension',
        id: 'pgvector',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
      },
    });
    expect(Object.keys(refs ?? {})).toEqual(['citext', 'pgvector']);
  });

  it('uses a known pack ref for a composed pack, and ignores a known ref for a pack not composed', () => {
    const known: ExtensionPackRef<'sql', string> = {
      kind: 'extension',
      id: 'citext',
      familyId: 'sql',
      targetId: 'postgres',
      version: '2.0.0',
    };
    const unused: ExtensionPackRef<'sql', string> = { ...known, id: 'postgis' };

    expect(composedExtensionPackRefs(target, ['citext'], [known, unused])).toEqual({
      citext: known,
    });
  });
});
