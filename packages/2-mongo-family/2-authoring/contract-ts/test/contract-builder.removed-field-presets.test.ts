import { describe, expect, it } from 'vitest';
import { defineContract, field, model } from '../src/contract-builder';
import { mongoFamilyPack, mongoTargetPack } from './mongo-test-packs';

const GUIDE = 'The upgrade guide "Field presets are removed" lists every rewrite.';

function readPath(root: object, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => Reflect.get(Object(value), key), root);
}

function refusalOf(path: string) {
  try {
    readPath(field, path);
  } catch (error) {
    return error;
  }
  throw new Error(`reading field.${path} did not throw`);
}

describe('a read of a field helper the MongoDB builder does not have', () => {
  it.each([
    ['temporal.createdAt', 'field.date().onCreate(gen.now())'],
    ['temporal.updatedAt', 'field.date().onCreate(gen.now()).onUpdate(gen.now())'],
    [
      'temporal.timestamp',
      'field.date(), with .onCreate(gen.now()) and .onUpdate(gen.now()) for the phases the preset set',
    ],
  ])('refuses the removed preset field.%s with its rewrite', (path, rewrite) => {
    expect(refusalOf(path)).toMatchObject({
      code: 'CONTRACT.FIELD_HELPER_UNKNOWN',
      message: `field.${path} was a field preset, and Prisma 8 removed field presets. Write ${rewrite}. ${GUIDE}`,
      meta: { helper: `field.${path}` },
    });
  });

  it('reads every name that was never a preset as on the helpers', () => {
    expect(
      ['length', 'name', 'default', 'text', 'temporal.now', 'temporal.length'].map((path) =>
        readPath(field, path),
      ),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it('refuses the read in a defineContract callback', () => {
    expect(() =>
      defineContract({ family: mongoFamilyPack, target: mongoTargetPack }, ({ field: f }) => ({
        models: {
          Post: model('Post', {
            collection: 'posts',
            fields: {
              _id: f.objectId(),
              createdAt: Reflect.get(Object(Reflect.get(f, 'temporal')), 'createdAt'),
            },
          }),
        },
      })),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.FIELD_HELPER_UNKNOWN' }));
  });

  it('keeps every helper the builder has', () => {
    expect([field.date().__type, Object.keys(field).includes('json')]).toEqual([
      { kind: 'scalar', codecId: 'mongo/date@1' },
      true,
    ]);
  });
});
