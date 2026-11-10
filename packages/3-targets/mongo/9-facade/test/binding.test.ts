import { describe, expect, it } from 'vitest';
import { resolveMongoBinding } from '../src/runtime/binding';

describe('resolveMongoBinding with a connection string', () => {
  it('accepts a seed list with credentials and a replica set', () => {
    const url =
      'mongodb://user:password@host1:27017,host2:27017,host3:27017/absensi?replicaSet=my-replica-set';

    expect(resolveMongoBinding({ url })).toEqual({ kind: 'url', url, dbName: 'absensi' });
  });

  it('accepts a bracketed IPv6 seed list', () => {
    const url = 'mongodb://[::1]:27017,[::2]:27017/db';

    expect(resolveMongoBinding({ url })).toEqual({ kind: 'url', url, dbName: 'db' });
  });

  it('accepts a single host whose password contains a comma', () => {
    const url = 'mongodb://user:pa,ss@host1:27017/db';

    expect(resolveMongoBinding({ url })).toEqual({ kind: 'url', url, dbName: 'db' });
  });

  it('accepts a seed list whose credentials percent-encode @, : and /', () => {
    const url = 'mongodb://us%40er:p%40ss%3A%2F@host1:27017,host2:27017/db';

    expect(resolveMongoBinding({ url })).toEqual({ kind: 'url', url, dbName: 'db' });
  });

  it('accepts a mongodb+srv url', () => {
    const url = 'mongodb+srv://user:pw@cluster0.example.net/db?retryWrites=true&w=majority';

    expect(resolveMongoBinding({ url })).toEqual({ kind: 'url', url, dbName: 'db' });
  });

  it('accepts a seed list passed as { uri, dbName }', () => {
    const uri = 'mongodb://host1:27017,host2:27017/?replicaSet=rs';

    expect(resolveMongoBinding({ uri, dbName: 'app' })).toEqual({
      kind: 'url',
      url: uri,
      dbName: 'app',
    });
  });

  it.each([
    ['a non-ASCII database name', 'mongodb://host1:27017/données'],
    ['a percent-encoded database name', 'mongodb://host1:27017,host2:27017/donn%C3%A9es'],
  ])('decodes %s the way the driver does', (_name, url) => {
    expect(resolveMongoBinding({ url })).toEqual({ kind: 'url', url, dbName: 'données' });
  });

  it('rejects a database name with malformed percent-encoding', () => {
    expect(() => resolveMongoBinding({ url: 'mongodb://host1:27017/%E0%A4%A' })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.BINDING_INVALID',
        message: 'Mongo URL must be a valid URL',
      }),
    );
  });

  it('rejects a seed list without a database name in the path', () => {
    expect(() => resolveMongoBinding({ url: 'mongodb://h1:27017,h2:27017' })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.BINDING_INVALID',
        message:
          'Mongo URL must include a database name in its path (e.g. mongodb://host:27017/mydb), or pass dbName explicitly',
      }),
    );
  });

  it.each([
    ['a mongodb+srv url with several hosts', 'mongodb+srv://a.example.net,b.example.net/db'],
    ['a mongodb+srv url with a port', 'mongodb+srv://cluster0.example.net:27017/db'],
    ['an unescaped @ in the password', 'mongodb://user:p@ss@host1:27017,host2:27017/db'],
    ['malformed percent-encoding in the password', 'mongodb://user:p%zz@host1:27017/db'],
    ['a scheme without //', 'mongodb:host1/db'],
  ])('rejects %s as an invalid URL', (_name, url) => {
    expect(() => resolveMongoBinding({ url })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.BINDING_INVALID',
        message: 'Mongo URL must be a valid URL',
      }),
    );
  });

  it('rejects an upper-case scheme, which the driver does not accept', () => {
    expect(() => resolveMongoBinding({ url: 'MONGODB://host1:27017/db' })).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.BINDING_INVALID',
        message: 'Mongo URL must use mongodb:// or mongodb+srv://',
      }),
    );
  });
});
