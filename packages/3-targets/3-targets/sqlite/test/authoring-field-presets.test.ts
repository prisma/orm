import {
  collectScalarTypeConstructors,
  temporalAuthoringPresets,
  temporalCodecPreset,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { sqliteAuthoringFieldPresets, sqliteAuthoringTypes } from '../src/core/authoring';

describe('sqliteAuthoringFieldPresets', () => {
  it('contributes BigIntNumber as its only integer-representation type', () => {
    expect(Object.fromEntries(collectScalarTypeConstructors(sqliteAuthoringTypes))).toEqual({
      BigIntNumber: {
        codecId: 'sqlite/bigintnumber@1',
        nativeType: 'integer',
      },
    });
  });

  it('does not expose integer representations as field presets', () => {
    expect(sqliteAuthoringFieldPresets).not.toHaveProperty('bigIntNumber');
    expect(sqliteAuthoringFieldPresets).not.toHaveProperty('unboundedInt');
  });

  it('carries no bigint preset, so bare BigInt stays on the scalar-resolved sqlite/bigint@1', () => {
    expect(sqliteAuthoringFieldPresets).not.toHaveProperty('bigint');
  });
});

describe('sqlite temporal per-codec presets', () => {
  it('registers datetime against sqlite/datetime@1, named for the codec base name', () => {
    expect(sqliteAuthoringFieldPresets.temporal.datetime).toEqual(
      temporalCodecPreset({ codecId: 'sqlite/datetime@1', nativeType: 'text' }),
    );
  });

  it('declares no precision argument, since sqlite/datetime@1 takes no params', () => {
    expect(sqliteAuthoringFieldPresets.temporal.datetime.args.map((arg) => arg.name)).toEqual([
      'onCreate',
      'onUpdate',
    ]);
    expect(sqliteAuthoringFieldPresets.temporal.datetime.output).not.toHaveProperty('typeParams');
  });

  it('keeps the createdAt/updatedAt convenience presets alongside the new sibling', () => {
    expect(sqliteAuthoringFieldPresets.temporal).toEqual({
      ...temporalAuthoringPresets({ codecId: 'sqlite/datetime@1', nativeType: 'text' }),
      datetime: temporalCodecPreset({ codecId: 'sqlite/datetime@1', nativeType: 'text' }),
    });
  });
});
