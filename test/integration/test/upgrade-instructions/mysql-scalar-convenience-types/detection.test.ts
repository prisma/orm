import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const APP = 'upgrade-instructions/pending/mysql-scalar-convenience-types/app/instructions.md';
const EXTENSION =
  'upgrade-instructions/pending/mysql-scalar-convenience-types/extension/instructions.md';

const matcher = (guidePath: string, id: string) => (content: string) =>
  detectionPatterns(guidePath, id).some((pattern) => pattern.test(content));

describe.each([APP, EXTENSION])('the MySQL contract re-emit detection in %s', (guidePath) => {
  const config = matcher(guidePath, 'mysql-reemit-contract');

  it('matches a config of a MySQL or MariaDB project only', () => {
    expect({
      mysql: config("import { defineConfig } from '@prisma/orm-mysql/config';"),
      mariadb: config('import { defineConfig as ormConfig } from "@prisma/orm-mariadb/config";'),
      postgres: config("import { defineConfig } from '@prisma/orm-postgres/config';"),
      sqlite: config("import { defineConfig } from '@prisma/orm-sqlite/config';"),
      mysqlRuntime: config("import mysql from '@prisma/orm-mysql/runtime';"),
    }).toEqual({
      mysql: true,
      mariadb: true,
      postgres: false,
      sqlite: false,
      mysqlRuntime: false,
    });
  });
});

describe('the MySQL codec descriptor wrapParameter detection', () => {
  const descriptor = matcher(EXTENSION, 'mysql-codec-descriptor-wrap-parameter');

  it('matches a file that names AnyMysqlCodecDescriptor and has no wrapParameter', () => {
    expect({
      implementsItself: descriptor(
        'class Point implements AnyMysqlCodecDescriptor {\n  projectJson(e) { return e; }\n}',
      ),
      typedObject: descriptor(
        'const point: AnyMysqlCodecDescriptor = {\n  codecId: "x/point@1",\n};',
      ),
      alreadyWrites: descriptor(
        'class Point implements AnyMysqlCodecDescriptor {\n  wrapParameter(p, ref) { return p; }\n}',
      ),
      extendsBase: descriptor('class Point extends MysqlCodecDescriptor<void> {}'),
      adapted: descriptor('export const point = mysqlCodec(pointDescriptor, options);'),
      prefixedName: descriptor('type X = MyAnyMysqlCodecDescriptorLike;'),
      oldMethodOnly: descriptor(
        'class Point implements AnyMysqlCodecDescriptor {\n  writeParameter(p: string) { return p; }\n}',
      ),
    }).toEqual({
      implementsItself: true,
      typedObject: true,
      alreadyWrites: false,
      extendsBase: false,
      adapted: false,
      prefixedName: false,
      oldMethodOnly: true,
    });
  });

  it('also matches a file that uses the type only as a parameter type, which needs no change', () => {
    expect(descriptor('function register(d: AnyMysqlCodecDescriptor) {}')).toBe(true);
  });
});
