import type { DataTypeSupport } from '@internal/framework-components/authoring';
import { mongoDataTypeLookup } from '@internal/mongo-contract/test';

export const mongoDataTypeSupport: DataTypeSupport = {
  entries: {},
  lookup: mongoDataTypeLookup,
  dataTypeOfCodec: () => undefined,
};
