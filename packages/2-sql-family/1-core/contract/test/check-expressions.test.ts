import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import { describe, expect, it } from 'vitest';
import {
  discriminatorValueSet,
  resolveColumnValueObject,
  resolveValueObject,
} from '../src/check-expressions';

function valueObjectRef(name: string) {
  return {
    plane: 'storage',
    namespaceId: 'public',
    entityKind: 'valueObject',
    entityName: name,
  } as const;
}

const text = { nullable: false, many: false, type: { kind: 'scalar', codecId: 'pg/text@1' } };

function nested(name: string, extra: Record<string, unknown> = {}) {
  return {
    nullable: false,
    many: false,
    type: { kind: 'valueObject', ...valueObjectRef(name) },
    ...extra,
  };
}

const codecs = {
  descriptorFor: (codecId: string) =>
    (codecId === 'pg/text@1' ? { codecId, jsonType: 'string' } : { codecId }) as AnyCodecDescriptor,
};

function storageWith(entries: Record<string, Record<string, unknown>>) {
  return { namespaces: { public: { id: 'public', entries } } };
}

describe('resolveValueObject', () => {
  it('inlines nested value objects and reads enum members from their value sets', () => {
    const storage = storageWith({
      valueObject: {
        Address: {
          fields: {
            street: text,
            kind: {
              nullable: true,
              many: false,
              type: { kind: 'scalar', codecId: 'pg/text@1' },
              valueSet: {
                plane: 'storage',
                namespaceId: 'public',
                entityKind: 'valueSet',
                entityName: 'AddressKind',
              },
            },
            geo: nested('Geo', { many: { elementNullable: true } }),
          },
        },
        Geo: { fields: { lat: text } },
      },
      valueSet: { AddressKind: { kind: 'valueSet', values: ['home', 'work'] } },
    });

    expect(resolveValueObject(storage, valueObjectRef('Address'), codecs)).toEqual({
      fields: {
        street: {
          nullable: false,
          many: false,
          type: { kind: 'scalar', jsonType: 'string', values: undefined },
        },
        kind: {
          nullable: true,
          many: false,
          type: { kind: 'scalar', jsonType: 'string', values: ['home', 'work'] },
        },
        geo: {
          nullable: false,
          many: { elementNullable: true },
          type: {
            kind: 'valueObject',
            valueObject: {
              fields: {
                lat: {
                  nullable: false,
                  many: false,
                  type: { kind: 'scalar', jsonType: 'string', values: undefined },
                },
              },
            },
          },
        },
      },
    });
  });

  it('accepts any object where a value object that contains itself refers back to itself', () => {
    const storage = storageWith({
      valueObject: {
        NavItem: {
          fields: {
            label: text,
            children: nested('NavItem', { many: { elementNullable: false } }),
          },
        },
      },
    });

    expect(resolveValueObject(storage, valueObjectRef('NavItem'), codecs)).toEqual({
      fields: {
        label: {
          nullable: false,
          many: false,
          type: { kind: 'scalar', jsonType: 'string', values: undefined },
        },
        children: {
          nullable: false,
          many: { elementNullable: false },
          type: { kind: 'anyObject' },
        },
      },
    });
  });

  it('accepts any object at the first reference back into a group of value objects that contain each other', () => {
    const storage = storageWith({
      valueObject: {
        Folder: { fields: { name: text, entry: nested('Entry'), meta: nested('Meta') } },
        Entry: { fields: { parent: nested('Folder') } },
        Meta: { fields: { owner: text } },
      },
    });

    expect(resolveValueObject(storage, valueObjectRef('Folder'), codecs)).toEqual({
      fields: {
        name: {
          nullable: false,
          many: false,
          type: { kind: 'scalar', jsonType: 'string', values: undefined },
        },
        entry: { nullable: false, many: false, type: { kind: 'anyObject' } },
        meta: {
          nullable: false,
          many: false,
          type: {
            kind: 'valueObject',
            valueObject: {
              fields: {
                owner: {
                  nullable: false,
                  many: false,
                  type: { kind: 'scalar', jsonType: 'string', values: undefined },
                },
              },
            },
          },
        },
      },
    });
  });

  it('refuses a member whose codec declares no JSON type, naming the codec, the member and what to add', () => {
    const storage = storageWith({
      valueObject: {
        Address: {
          fields: { zip: { nullable: false, type: { kind: 'scalar', codecId: 'demo/zip@1' } } },
        },
      },
    });
    expect(() => resolveValueObject(storage, valueObjectRef('Address'), codecs)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.CODEC_JSON_TYPE_MISSING',
        message:
          'The codec "demo/zip@1" of value object "public:Address" member "zip" declares no jsonType, so the check of the value object cannot be derived.',
        meta: {
          codecId: 'demo/zip@1',
          valueObject: 'public:Address',
          member: 'zip',
          property: 'jsonType',
        },
      }),
    );
  });

  it('refuses a reference storage does not hold', () => {
    expect(() => resolveValueObject(storageWith({}), valueObjectRef('Missing'), codecs)).toThrow(
      /Missing/,
    );
  });
});

describe('resolveColumnValueObject', () => {
  it('holds the column nullability and list shape with the resolved value object', () => {
    const storage = storageWith({ valueObject: { Address: { fields: {} } } });
    expect(
      resolveColumnValueObject(
        storage,
        {
          reference: valueObjectRef('Address'),
          nullable: true,
          many: { elementNullable: false },
        },
        codecs,
      ),
    ).toEqual({
      nullable: true,
      many: { elementNullable: false },
      valueObject: resolveValueObject(storage, valueObjectRef('Address'), codecs),
    });
  });
});

describe('discriminatorValueSet', () => {
  it('is keyed by the base model and field, and holds the variant values sorted', () => {
    expect(discriminatorValueSet('Task', 'type', ['feature', 'bug'])).toEqual({
      name: 'Task.type',
      values: ['bug', 'feature'],
    });
  });
});
