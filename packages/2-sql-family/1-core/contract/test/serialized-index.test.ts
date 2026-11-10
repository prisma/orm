import { describe, expect, it } from 'vitest';
import { indexInputFromSerialized, type SerializedIndex } from '../src/serialized-index';

describe('indexInputFromSerialized', () => {
  it('carries a wire-named entry through as the wire naming arm', () => {
    expect(
      indexInputFromSerialized({
        name: 'users_email_idx_ab12cd34',
        prefix: 'users_email_idx',
        columns: ['email'],
        unique: false,
      }),
    ).toMatchObject({
      naming: { kind: 'wire', prefix: 'users_email_idx', hash: 'ab12cd34' },
      columns: ['email'],
    });
  });

  it('carries an entry with no prefix through as the exact naming arm', () => {
    expect(
      indexInputFromSerialized({ name: 'users_email_key', columns: ['email'], unique: false }),
    ).toMatchObject({ naming: { kind: 'exact', name: 'users_email_key' } });
  });

  it('rejects a missing name (unvalidated JSON input)', () => {
    const raw: unknown = { columns: ['email'], unique: false };
    expect(() => indexInputFromSerialized(raw as SerializedIndex)).toThrow(/full physical name/);
  });

  it('rejects both columns and expression', () => {
    const raw: unknown = {
      name: 'users_email_eq',
      columns: ['email'],
      expression: 'lower(email)',
      unique: false,
    };
    expect(() => indexInputFromSerialized(raw as SerializedIndex)).toThrow(
      /exactly one of columns or expression/,
    );
  });

  it('rejects neither columns nor expression', () => {
    const raw: unknown = { name: 'users_email_eq', unique: false };
    expect(() => indexInputFromSerialized(raw as SerializedIndex)).toThrow(
      /exactly one of columns or expression/,
    );
  });

  it('rejects a prefix the name does not carry as a wire suffix', () => {
    expect(() =>
      indexInputFromSerialized({
        name: 'users_email_idx',
        prefix: 'users_email_idx',
        columns: ['email'],
        unique: false,
      }),
    ).toThrow(/does not match the wire name/);
  });

  it('rejects a prefix the name parses to differently', () => {
    expect(() =>
      indexInputFromSerialized({
        name: 'other_prefix_deadbeef',
        prefix: 'users_email_idx',
        columns: ['email'],
        unique: false,
      }),
    ).toThrow(/does not match the wire name/);
  });

  it('leaves an exact name that happens to parse as a wire name exact', () => {
    expect(
      indexInputFromSerialized({
        name: 'adopted_live_name_deadbeef',
        columns: ['email'],
        unique: false,
      }),
    ).toMatchObject({ naming: { kind: 'exact', name: 'adopted_live_name_deadbeef' } });
  });
});
