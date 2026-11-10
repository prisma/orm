import { extractCodecLookup } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { ARKTYPE_JSON_CODEC_ID } from '../src/core/arktype-json-codec';
import { arktypeJsonRuntimeDescriptor } from '../src/exports/runtime';

describe('arktypeJsonRuntimeDescriptor', () => {
  // The runtime descriptor is the SQL runtime's entry point for arktype-json. The contributor protocol is unified: every codec — parameterized or not — flows through the single `codecs:` slot returning a `CodecDescriptor` list. arktype-json contributes exactly one descriptor: `arktypeJsonDescriptor`.
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
