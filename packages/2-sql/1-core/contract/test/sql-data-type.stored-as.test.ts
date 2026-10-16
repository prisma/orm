import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import {
  renderSqlTypeName,
  resolveReportedSqlType,
  sqlDataType,
  sqlStorageType,
  sqlStorageTypeId,
  sqlStorageTypeOfCodec,
} from '../src/sql-data-type';

const text = sqlDataType('t/text', {
  read: (json) => json,
  texts: [{ text: 'text', written: true, catalog: true }],
});
const datetime = sqlDataType('t/datetime', { read: (json) => json, storedAs: text.id });

describe('a data type stored as another', () => {
  it('records the type it is stored as, and declares no texts of its own', () => {
    expect({ storedAs: datetime.sql.storedAs, texts: datetime.sql.texts }).toEqual({
      storedAs: 't/text',
      texts: [],
    });
  });

  it('refuses a declaration that has texts of its own too', () => {
    expect(() =>
      sqlDataType('t/both', {
        read: (json) => json,
        storedAs: text.id,
        texts: [{ text: 'datetime', written: true }],
      }),
    ).toThrow(
      new InternalError(
        'Data type t/both: a type stored as another declares no texts; its name is the name of the type it is stored as.',
      ),
    );
  });

  it('refuses a declaration that claims a kind too', () => {
    expect(() =>
      sqlDataType('t/kind', {
        read: (json) => json,
        storedAs: text.id,
        claimsKind: 'enum',
        render: () => 'x',
      }),
    ).toThrow(InternalError);
  });

  it('is named by the type it is stored as', () => {
    const lookup = createDataTypeLookup([text, datetime]);
    const storage = sqlStorageType(datetime, lookup);
    expect({ storage: storage.id, name: renderSqlTypeName(storage, {}) }).toEqual({
      storage: 't/text',
      name: 'text',
    });
  });

  it('is its own storage type when it names none', () => {
    expect(sqlStorageType(text, createDataTypeLookup([text]))).toBe(text);
  });

  it('is the storage type of the codec that represents it', () => {
    const codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'> = {
      descriptorFor: (id) =>
        (id === 't/datetime@1' ? { codecId: id, dataType: datetime.id } : undefined) as never,
    };
    const dataTypeLookup = createDataTypeLookup([text, datetime]);
    expect(sqlStorageTypeOfCodec('t/datetime@1', { codecLookup, dataTypeLookup })).toBe(text);
  });

  it('refuses a storage type the stack does not register', () => {
    expect(() => sqlStorageType(datetime, createDataTypeLookup([datetime]))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DATA_TYPE_UNREGISTERED',
        meta: { dataType: 't/text', storedBy: 't/datetime' },
      }),
    );
  });

  it('gives the id of the storage type, and refuses as sqlStorageType does', () => {
    expect({
      stored: sqlStorageTypeId(datetime.id, createDataTypeLookup([text, datetime])),
      own: sqlStorageTypeId(text.id, createDataTypeLookup([text])),
      unknown: sqlStorageTypeId('t/unknown', createDataTypeLookup([text])),
    }).toEqual({ stored: 't/text', own: 't/text', unknown: 't/unknown' });
    expect(() => sqlStorageTypeId(datetime.id, createDataTypeLookup([datetime]))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DATA_TYPE_UNREGISTERED',
        meta: { dataType: 't/text', storedBy: 't/datetime' },
      }),
    );
  });

  it('claims no reported type, so a reported text resolves to its storage type', () => {
    const reported = { text: 'text', kind: undefined, schema: undefined, name: undefined };
    expect(resolveReportedSqlType(reported, [text, datetime])).toEqual({
      dataType: 't/text',
      typeParams: {},
    });
  });
});
