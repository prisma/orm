import type { DataTypeSupport } from '@internal/framework-components/authoring';
import { dataTypeId } from '@internal/framework-components/codec';
import { mongoCodecLookup, mongoDataTypeLookup } from '@internal/mongo-contract/test';

const mongoString = dataTypeId('mongo/string');

/** The fake MongoDB data types, with a quoted string read as `mongo/string`, the one text data type. */
export const mongoDataTypeSupport: DataTypeSupport = {
  entries: {
    [mongoString]: {
      written: { kind: 'plain', syntax: 'string', parse: (text) => text },
      print: (value) => String(value),
      documentation: 'Text.',
    },
  },
  lookup: mongoDataTypeLookup,
  dataTypeOfCodec: (codecId) => mongoCodecLookup.descriptorFor(codecId)?.dataType,
  textDataTypes: [mongoString],
};
