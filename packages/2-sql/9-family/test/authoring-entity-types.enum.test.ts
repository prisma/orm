import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import {
  BROKEN_CODEC_ID,
  ENCODE_FOLDING_CODEC_ID,
  enumBlock,
  FOLDING_CODEC_ID,
  factory,
  INT_CODEC_ID,
  JSON_CODEC_ID,
  makeContext,
  TEXT_CODEC_ID,
} from './enum-entity-fixtures';

describe('sqlFamilyEnumEntityDescriptor: @@type omitted, inferred from members', () => {
  it('bare members infer the text codec and decode from their key', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Role', values: { admin: undefined, user: undefined } }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({
      codecId: TEXT_CODEC_ID,
      members: { admin: 'admin', user: 'user' },
    });
  });

  it('string members infer the text codec', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Role', values: { admin: 'admin', user: 'user' } }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({
      codecId: TEXT_CODEC_ID,
      members: { admin: 'admin', user: 'user' },
    });
  });

  it('a mix of bare and string members still infers the text codec', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Role', values: { admin: undefined, user: 'user' } }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({ codecId: TEXT_CODEC_ID });
  });

  it('integer members infer the int codec', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Priority', values: { low: 1, high: 2 } }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({
      codecId: INT_CODEC_ID,
      members: { low: 1, high: 2 },
    });
  });

  it('a float member cannot be inferred', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Priority', values: { low: 1.5 } }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]);
  });

  it('a boolean member cannot be inferred', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Flag', values: { on: true } }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]);
  });

  it('an explicit null member cannot be inferred and is not a bare member', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Odd', values: { none: null } }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]);
  });

  it('a mix of string and integer members cannot be inferred', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Mixed', values: { low: 'low', high: 2 } }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]);
  });

  it('the diagnostic names the enum and suggests an explicit @@type', () => {
    const diagnostics: { code: string; message: string }[] = [];
    factory(enumBlock({ name: 'Priority', values: { low: 1.5 } }), makeContext(diagnostics));

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_ENUM_CANNOT_INFER_TYPE',
        message: expect.stringMatching(/Priority/),
      }),
    ]);
    expect(diagnostics[0]?.message).toMatch(/@@type/);
  });

  it('an empty enum cannot be inferred', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(enumBlock({ name: 'Empty', values: {} }), makeContext(diagnostics));

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_CANNOT_INFER_TYPE' })]);
  });
});

describe('sqlFamilyEnumEntityDescriptor: explicit @@type bypasses inference, never validation', () => {
  it('an explicit @@type is used verbatim, skipping inference entirely', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Priority', values: { low: 1.5 }, typeCodecId: TEXT_CODEC_ID }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_EXTENSION_INVALID_VALUE' })]);
    expect(handle).toBeUndefined();
  });

  it('an explicit @@type resolving to text lowers exactly as before', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Role', values: { admin: 'admin' }, typeCodecId: TEXT_CODEC_ID }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({ codecId: TEXT_CODEC_ID });
  });

  it('an explicit codec receives structured JSON media through the shared grammar', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Config',
        values: { region: { zone: 'a', replicas: [1, 2] }, tags: ['x', 'y'] },
        typeCodecId: JSON_CODEC_ID,
      }),
      makeContext(diagnostics),
    );

    expect(diagnostics).toEqual([]);
    expect(handle).toMatchObject({
      codecId: JSON_CODEC_ID,
      members: { region: { zone: 'a', replicas: [1, 2] }, tags: ['x', 'y'] },
    });
  });

  it('accepts two different object members and two different array members', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Config',
        values: { east: { zone: 'a' }, west: { zone: 'b' }, small: [1], large: [1, 2] },
        typeCodecId: JSON_CODEC_ID,
      }),
      makeContext(diagnostics),
    );

    expect({ diagnostics, members: handle?.members }).toEqual({
      diagnostics: [],
      members: { east: { zone: 'a' }, west: { zone: 'b' }, small: [1], large: [1, 2] },
    });
  });

  it('an explicit null member reaches the codec and its rejection is reported', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Odd', values: { none: null }, typeCodecId: JSON_CODEC_ID }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message: expect.stringContaining('rejected by codec'),
      }),
    ]);
  });

  it('a bare member under a non-string codec is its own diagnostic', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Priority', values: { low: undefined }, typeCodecId: INT_CODEC_ID }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC' }),
    ]);
  });

  it('collides on DECODED values, not raw literals', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Folded',
        values: { first: 'Admin', second: 'admin' },
        typeCodecId: FOLDING_CODEC_ID,
      }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE',
        message: expect.stringContaining('"admin"'),
      }),
    ]);
  });

  it('collides on the values the contract stores, naming both members', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({
        name: 'Folded',
        values: { first: 'Admin', second: 'admin' },
        typeCodecId: ENCODE_FOLDING_CODEC_ID,
      }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE',
        message: 'enum "Folded": members "first" and "second" both store "admin"',
      }),
    ]);
  });

  it('an explicit-codec empty enum is reported as missing members', () => {
    const diagnostics: unknown[] = [];
    const handle = factory(
      enumBlock({ name: 'Empty', values: {}, typeCodecId: TEXT_CODEC_ID }),
      makeContext(diagnostics),
    );

    expect(handle).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'PSL_ENUM_MISSING_TYPE' })]);
  });
});

describe('sqlFamilyEnumEntityDescriptor: a codec internal error', () => {
  it.each([
    ['a member with a value', { low: 'low' }],
    ['a bare member', { low: undefined }],
  ])('passes through for %s, instead of becoming a diagnostic', (_label, values) => {
    const diagnostics: unknown[] = [];
    expect(() =>
      factory(
        enumBlock({ name: 'Level', values, typeCodecId: BROKEN_CODEC_ID }),
        makeContext(diagnostics),
      ),
    ).toThrow(InternalError);
    expect(diagnostics).toEqual([]);
  });
});
