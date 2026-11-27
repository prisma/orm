import { postgres16 } from '../../../src/contract/contract-capabilities';

// A list that leaves out a capability of the version, adds the driver's and one nothing in this release provides, which every authoring route must store the same way.
export const requiredList = [
  ...postgres16.filter((capability) => capability !== 'sql.returning'),
  'sql.interactiveTransactions',
  'http.batch',
] as const;
