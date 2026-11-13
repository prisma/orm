import { describe, expect, it } from 'vitest';
import { defineContract, field, model } from '../src/contract-builder';
import { mongoFamilyPack, mongoTargetPack, type } from './mongo-test-packs';

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
    ['temporal.createdAt', 'field.scalar(type.temporal.CreatedAt())'],
    ['temporal.updatedAt', 'field.scalar(type.temporal.UpdatedAt())'],
    [
      'temporal.timestamp',
      'field.scalar(type.DateTime()), with .onCreate(gen.now()) and .onUpdate(gen.now()) for the phases the preset set',
    ],
  ])('refuses the removed preset field.%s with its rewrite', (path, rewrite) => {
    expect(refusalOf(path)).toMatchObject({
      code: 'CONTRACT.FIELD_HELPER_UNKNOWN',
      message: `field.${path} was a field preset, and Prisma 8 removed field presets. Write ${rewrite}. ${GUIDE}`,
      meta: { helper: `field.${path}` },
    });
  });

  it.each([
    ['objectId', 'field.scalar(type.ObjectId())'],
    ['string', 'field.scalar(type.String())'],
    ['double', 'field.scalar(type.Double())'],
    ['int32', 'field.scalar(type.Int32())'],
    ['bool', 'field.scalar(type.Bool())'],
    ['date', 'field.scalar(type.DateTime())'],
    ['int64', 'field.scalar(type.Int64())'],
    ['int64Number', 'field.scalar(type.Int64Number())'],
    ['decimal128', 'field.scalar(type.Decimal128())'],
    ['binary', 'field.scalar(type.Binary())'],
    ['json', 'field.scalar(type.Json())'],
    ['bson', 'field.scalar(type.Bson())'],
    ['vector', 'field.scalar(type.Vector()), or field.scalar(type.Vector(n)) for a length n'],
  ])('refuses the removed scalar helper field.%s with its rewrite', (name, rewrite) => {
    expect(refusalOf(name)).toMatchObject({
      code: 'CONTRACT.FIELD_HELPER_UNKNOWN',
      message: `field.${name}() was removed. Write ${rewrite}.`,
      meta: { helper: `field.${name}` },
    });
  });

  it.each([
    ['mongo/string@1', 'field.scalar(type.String())'],
    ['mongo/objectId@1', 'field.scalar(type.ObjectId())'],
    ['mongo/vector@1', 'field.scalar(type.Vector())'],
  ])('refuses field.scalar given the codec id %s, naming the type to write', (codecId, rewrite) => {
    expect(() => Reflect.apply(field.scalar, field, [codecId])).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: `field.scalar() takes a type, not the codec id "${codecId}". Write ${rewrite}.`,
        meta: { helper: 'field.scalar' },
      }),
    );
  });

  it('refuses field.scalar given anything else that is not a type', () => {
    expect(() => Reflect.apply(field.scalar, field, ['geo/point@1'])).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message:
          'field.scalar() takes a type from the type helpers, such as field.scalar(type.String()), and was given "geo/point@1".',
        meta: { helper: 'field.scalar' },
      }),
    );
  });

  it('reads every name that was never a helper as on the helpers', () => {
    expect(
      ['length', 'name', 'default', 'text', 'temporal.now', 'temporal.length'].map((path) =>
        readPath(field, path),
      ),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it('refuses the read in a defineContract callback', () => {
    expect(() =>
      defineContract({ family: mongoFamilyPack, target: mongoTargetPack }, (helpers) => ({
        models: {
          Post: model('Post', {
            collection: 'posts',
            fields: {
              _id: helpers.field.scalar(helpers.type.ObjectId()),
              createdAt: Reflect.get(Object(Reflect.get(helpers.field, 'temporal')), 'createdAt'),
            },
          }),
        },
      })),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.FIELD_HELPER_UNKNOWN' }));
  });

  it('keeps every helper the builder has', () => {
    expect({
      scalar: field.scalar(type.DateTime()).__type,
      helpers: Object.keys(field).sort(),
    }).toEqual({
      scalar: { kind: 'scalar', codecId: 'mongo/date@1' },
      helpers: ['namedType', 'scalar', 'valueObject'],
    });
  });
});
