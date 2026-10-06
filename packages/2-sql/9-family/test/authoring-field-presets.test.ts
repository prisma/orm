import { describe, expect, it } from 'vitest';
import {
  nanoidIdPresetMirror,
  nanoidOptionsArgumentMirror,
  nanoidPresetMirror,
} from '../../2-authoring/contract-ts/test/nanoid-preset-mirror';
import { sqlFamilyAuthoringFieldPresets } from '../src/core/authoring-field-presets';

describe('sqlFamilyAuthoringFieldPresets', () => {
  it('exposes uuidString preset with char(36) codec', () => {
    expect(sqlFamilyAuthoringFieldPresets.uuidString).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'sql/char@1',
        typeParams: { length: 36 },
      },
    });
  });

  it('does not expose a plain uuid preset', () => {
    expect('uuid' in sqlFamilyAuthoringFieldPresets).toBe(false);
  });

  it('exposes id.uuidv4String preset with char(36) codec and uuidv4 generator', () => {
    expect(sqlFamilyAuthoringFieldPresets.id.uuidv4String).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'sql/char@1',
        typeParams: { length: 36 },
        executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv4' } },
        id: true,
      },
    });
  });

  it('exposes id.uuidv7String preset with char(36) codec and uuidv7 generator', () => {
    expect(sqlFamilyAuthoringFieldPresets.id.uuidv7String).toMatchObject({
      kind: 'fieldPreset',
      output: {
        codecId: 'sql/char@1',
        typeParams: { length: 36 },
        executionDefaults: { onCreate: { kind: 'generator', id: 'uuidv7' } },
        id: true,
      },
    });
  });

  it('does not expose plain id.uuidv4 or id.uuidv7 presets', () => {
    expect('uuidv4' in sqlFamilyAuthoringFieldPresets.id).toBe(false);
    expect('uuidv7' in sqlFamilyAuthoringFieldPresets.id).toBe(false);
  });

  it('keeps ulid, nanoid, cuid2, ksuid presets unchanged', () => {
    expect('ulid' in sqlFamilyAuthoringFieldPresets).toBe(true);
    expect('nanoid' in sqlFamilyAuthoringFieldPresets).toBe(true);
    expect('cuid2' in sqlFamilyAuthoringFieldPresets).toBe(true);
    expect('ksuid' in sqlFamilyAuthoringFieldPresets).toBe(true);
    expect('ulid' in sqlFamilyAuthoringFieldPresets.id).toBe(true);
    expect('nanoid' in sqlFamilyAuthoringFieldPresets.id).toBe(true);
    expect('cuid2' in sqlFamilyAuthoringFieldPresets.id).toBe(true);
    expect('ksuid' in sqlFamilyAuthoringFieldPresets.id).toBe(true);
  });
});

/**
 * contract-ts hand-mirrors these two shipping presets because it cannot import
 * family-sql (family-sql depends on contract-ts in production, so the reverse
 * is a cycle). Its authoring type tests, helper-runtime tests, and contract
 * DSL tests all run against those mirrors.
 *
 * These assertions are the only thing that fails if a change here leaves the
 * mirrors stale — the mirrors are otherwise pinned by nothing.
 *
 * The `args[0]` assertions carry the most weight. `nanoidOptionsArgument`
 * declares every property optional, which makes contract-ts's
 * `ObjectArgumentType` emit a plain weak type; weak-type detection is then the
 * only thing rejecting `field.id.nanoid({ bogus: 1 })` and the only thing
 * routing `field.id.nanoid({ name: 'x' })` to the named-constraint overload,
 * because the TS authoring surface performs no runtime argument validation
 * (`buildFieldPreset` calls `instantiateAuthoringFieldPreset` directly).
 * Making `size` required would send `ObjectArgumentType` down its intersection
 * branch and silently remove that protection — producing an unnamed primary
 * key on a length-21 nanoid column with no diagnostic at any layer. These
 * assertions exist so that change lands as a red test instead.
 */
describe('contract-ts mirrors of the nanoid presets', () => {
  it('mirrors the nanoid options argument that keeps the weak-type check alive', () => {
    expect(nanoidOptionsArgumentMirror).toEqual(sqlFamilyAuthoringFieldPresets.nanoid.args[0]);
    expect(nanoidOptionsArgumentMirror).toEqual(sqlFamilyAuthoringFieldPresets.id.nanoid.args[0]);
  });

  it('mirrors the nanoid preset', () => {
    expect(nanoidPresetMirror).toEqual(sqlFamilyAuthoringFieldPresets.nanoid);
  });

  it('mirrors the id.nanoid preset', () => {
    expect(nanoidIdPresetMirror).toEqual(sqlFamilyAuthoringFieldPresets.id.nanoid);
  });
});
