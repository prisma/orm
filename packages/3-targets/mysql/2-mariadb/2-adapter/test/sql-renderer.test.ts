import { MysqlSqlRenderer } from '@internal/adapter-mysql/sql-renderer';
import {
  type AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  InsertAst,
  InsertOnConflict,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { createMysqlBuiltinCodecLookup } from '@internal/target-mysql/codecs';
import { describe, expect, it } from 'vitest';
import { MariadbSqlRenderer } from '../src/core/sql-renderer';

const codecs = createMysqlBuiltinCodecLookup();
const mariadb = new MariadbSqlRenderer(codecs);
const mysql = new MysqlSqlRenderer(codecs);
const sqlOf = (ast: AnyQueryAst) => mariadb.render(ast, undefined).sql;

const upsertInto = (rows: number) =>
  InsertAst.into(TableSource.named('user', 'u')).withRows(
    Array.from({ length: rows }, (_, index) => ({
      email: ParamRef.of(`${index}@b.c`),
      role: ParamRef.of('USER'),
    })),
  );

describe('MariaDB lowering of an upsert', () => {
  it('writes no row alias, and the proposed row as VALUES(column), which MariaDB has where MySQL 8.4 writes new.column', () => {
    const ast = upsertInto(1).withOnConflict(
      InsertOnConflict.on([]).doUpdateSet({
        email: ColumnRef.of('excluded', 'email'),
        role: ColumnRef.of('u', 'role'),
      }),
    );
    expect({ mariadb: sqlOf(ast), mysql: mysql.render(ast, undefined).sql }).toEqual({
      mariadb:
        'INSERT INTO `user` (`email`, `role`) VALUES (?1, ?2) ON DUPLICATE KEY UPDATE `email` = VALUES(`email`), `role` = `user`.`role`',
      mysql:
        'INSERT INTO `user` (`email`, `role`) VALUES (?1, ?2) AS `new` ON DUPLICATE KEY UPDATE `email` = `new`.`email`, `role` = `user`.`role`',
    });
  });

  it('reads each inserted row through VALUES(column) when it inserts several', () => {
    expect(
      sqlOf(
        upsertInto(2).withOnConflict(
          InsertOnConflict.on([]).doUpdateSet({ email: ColumnRef.of('excluded', 'email') }),
        ),
      ),
    ).toBe(
      'INSERT INTO `user` (`email`, `role`) VALUES (?1, ?2), (?3, ?4) ON DUPLICATE KEY UPDATE `email` = VALUES(`email`)',
    );
  });

  it('binds an update value as MySQL does', () => {
    expect(
      mariadb.render(
        upsertInto(1).withOnConflict(
          InsertOnConflict.on([]).doUpdateSet({ role: ParamRef.of('ADMIN') }),
        ),
        undefined,
      ),
    ).toEqual({
      sql: 'INSERT INTO `user` (`email`, `role`) VALUES (?1, ?2) ON DUPLICATE KEY UPDATE `role` = ?3',
      params: [
        { kind: 'literal', value: '0@b.c' },
        { kind: 'literal', value: 'USER' },
        { kind: 'literal', value: 'ADMIN' },
      ],
    });
  });
});

describe('MariaDB lowering of other statements', () => {
  it('renders them as MySQL does', () => {
    const select = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'email'), ParamRef.of('a@b.c')));
    const insert = upsertInto(2);
    expect([sqlOf(select), sqlOf(insert)]).toEqual([
      mysql.render(select, undefined).sql,
      mysql.render(insert, undefined).sql,
    ]);
  });
});
