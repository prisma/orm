import { extractCodecLookup } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { ARKTYPE_JSON_CODEC_ID, arktypeJsonDescriptor } from '../src/core/arktype-json-codec';
import { arktypeJsonExtensionDescriptor } from '../src/exports/control';
import { arktypeJsonRuntimeDescriptor } from '../src/exports/runtime';

describe('arktypeJsonRuntimeDescriptor', () => {
  // The runtime descriptor is the SQL runtime's entry point for arktype-json. The contributor protocol is unified: every codec — parameterized or not — flows through the single `codecs:` slot returning a `CodecDescriptor` list. arktype-json contributes exactly one descriptor: `arktypeJsonDescriptor`.
  it('declares family, target, and version aligned with pack-meta', () => {
    expect(arktypeJsonRuntimeDescriptor.familyId).toBe('sql');
    expect(arktypeJsonRuntimeDescriptor.targetId).toBe('postgres');
    expect(arktypeJsonRuntimeDescriptor.kind).toBe('extension');
    expect(arktypeJsonRuntimeDescriptor.id).toBe('arktype-json');
  });

  it('contributes the arktype-json descriptor through the unified codecs slot', () => {
    // The contributor reads from the descriptor registry. The single entry is the canonical `arktypeJsonDescriptor`.
    const descriptors = arktypeJsonRuntimeDescriptor.codecs();
    expect(descriptors).toEqual([arktypeJsonDescriptor]);
    expect(descriptors[0]?.codecId).toBe(ARKTYPE_JSON_CODEC_ID);
  });

  it('create() returns an instance tagged with the family/target', () => {
    const instance = arktypeJsonRuntimeDescriptor.create();
    expect(instance.familyId).toBe('sql');
    expect(instance.targetId).toBe('postgres');
  });

  it('exposes arktype/json@1 metadata through types.codecTypes.codecDescriptors', () => {
    const codecDescriptors = arktypeJsonRuntimeDescriptor.types?.codecTypes?.codecDescriptors;
    expect(codecDescriptors).toContain(arktypeJsonDescriptor);
  });

  it('extractCodecLookup over the runtime descriptor resolves arktype/json@1 renderers', () => {
    const lookup = extractCodecLookup([arktypeJsonRuntimeDescriptor]);
    expect(
      lookup.renderOutputTypeFor(ARKTYPE_JSON_CODEC_ID, {
        expression: '{ name: string }',
        jsonIr: {},
      }),
    ).toBe('{ name: string }');
  });

  it('does not materialize an id-keyed representative without concrete typeParams', () => {
    const lookup = extractCodecLookup([arktypeJsonRuntimeDescriptor]);
    expect(lookup.get(ARKTYPE_JSON_CODEC_ID)).toBeUndefined();
  });
});

describe('arktypeJsonExtensionDescriptor (control)', () => {
  it('declares family, target, and version aligned with pack-meta', () => {
    expect(arktypeJsonExtensionDescriptor.familyId).toBe('sql');
    expect(arktypeJsonExtensionDescriptor.targetId).toBe('postgres');
    expect(arktypeJsonExtensionDescriptor.kind).toBe('extension');
    expect(arktypeJsonExtensionDescriptor.id).toBe('arktype-json');
  });

  it('create() returns an instance tagged with the family/target', () => {
    const instance = arktypeJsonExtensionDescriptor.create();
    expect(instance.familyId).toBe('sql');
    expect(instance.targetId).toBe('postgres');
  });
});
