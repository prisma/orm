import { buildEnumsMapForNamespace } from '@internal/contract/enum-accessor';
import type {
  Codec,
  CodecLookupWithDescriptors,
  DataTypeValue,
} from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { prisma6MongoBinding } from '@internal/target-mongo/prisma6-binding';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { prisma6Contract } from '../src/provider';
import { fixturesDir, mongoSourceContext, mongoStack } from './support';

const enumSchema = join(fixturesDir, 'enums', 'schema.prisma');

const stringCodec = mongoStack.codecLookup.get('mongo/string@1');
if (stringCodec === undefined) throw new Error('the Mongo stack has no mongo/string@1 codec');

const wrappedStringCodec = Object.assign(Object.create(stringCodec) as Codec, {
  toDataTypeValue: (v: unknown) =>
    stringCodec.dataType.valueFrom((v as { readonly text: string }).text, {}),
  fromDataTypeValue: (value: DataTypeValue) => ({ text: value.value }),
});

const codecLookup: CodecLookupWithDescriptors = {
  ...mongoStack.codecLookup,
  get: (id) => (id === 'mongo/string@1' ? wrappedStringCodec : mongoStack.codecLookup.get(id)),
  renderOutputTypeFor: (id, params) => mongoStack.codecLookup.renderOutputTypeFor(id, params),
};

async function loadWithWrappedStrings() {
  const result = await prisma6Contract('enums/schema.prisma', {
    binding: prisma6MongoBinding,
  }).source.load({ ...mongoSourceContext([enumSchema]), codecLookup });
  if (!result.ok) throw new Error(JSON.stringify(result.failure));
  return result.value;
}

describe('Prisma 6 MongoDB enum members', () => {
  it('are written in their stored form, the value the codec gives for each decoded value', async () => {
    const contract = await loadWithWrappedStrings();

    expect(contract.domain.namespaces[UNBOUND_NAMESPACE_ID]?.enum).toEqual({
      Status: {
        codecId: 'mongo/string@1',
        members: [
          { name: 'DRAFT', value: 'draft' },
          { name: 'PUBLISHED', value: 'published' },
        ],
      },
      Role: {
        codecId: 'mongo/string@1',
        members: [
          { name: 'USER', value: 'USER' },
          { name: 'ADMIN', value: 'ADMIN' },
        ],
      },
    });
  });

  it('decode back to the codec values through the enum accessor', async () => {
    const contract = await loadWithWrappedStrings();
    const enums = buildEnumsMapForNamespace(
      contract.domain,
      UNBOUND_NAMESPACE_ID,
      () => wrappedStringCodec,
    );

    expect({ Status: enums['Status']?.values, Role: enums['Role']?.values }).toEqual({
      Status: [{ text: 'draft' }, { text: 'published' }],
      Role: [{ text: 'USER' }, { text: 'ADMIN' }],
    });
  });
});
