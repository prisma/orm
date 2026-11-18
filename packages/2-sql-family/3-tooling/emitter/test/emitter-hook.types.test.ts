import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';

describe('default-literal typing', () => {
  /**
   * `getFamilyTypeAliases` returns several aliases joined into one string, so a
   * bare substring match would pass on a hit anywhere in the blob. These read
   * the `DefaultLiteralValue` declaration out of it first, and normalise
   * whitespace so a semantics-preserving reformat of the emitted source does not
   * fail the test.
   */
  function defaultLiteralValueDeclaration(): string {
    const aliases = sqlEmission.getFamilyTypeAliases?.() ?? '';
    const start = aliases.indexOf('type DefaultLiteralValue<');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = aliases.indexOf(';', start);
    expect(end).toBeGreaterThan(start);
    return aliases.slice(start, end).replace(/\s+/g, ' ');
  }

  it('resolves a literal default through the codec JSON channel, not its application type', () => {
    const declaration = defaultLiteralValueDeclaration();

    expect(declaration).toContain('CodecTypes[CodecId]["json"]');
    expect(declaration).not.toContain('CodecTypes[CodecId]["output"]');
  });

  it('keeps the emitted literal when the codec JSON channel admits it', () => {
    expect(defaultLiteralValueDeclaration()).toContain(
      'Encoded extends CodecTypes[CodecId]["json"] ? Encoded',
    );
  });
});
