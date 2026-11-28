import { expectTypeOf, test } from 'vitest';
import type {
  ContractFileLocation,
  convertContractDocument,
  readStoredDocument,
  StoredFileLocation,
} from '../src/format-version';

test('only a contract location can say the file is a snapshot', () => {
  expectTypeOf<Parameters<typeof convertContractDocument>[1]>().toEqualTypeOf<
    ContractFileLocation | undefined
  >();
  expectTypeOf<Parameters<typeof readStoredDocument>[2]>().toEqualTypeOf<
    StoredFileLocation | undefined
  >();
  // @ts-expect-error a migration or ref file is never a contract snapshot
  const location: StoredFileLocation = { path: 'refs/head.json', snapshot: true };
  expectTypeOf(location).toEqualTypeOf<StoredFileLocation>();
});
