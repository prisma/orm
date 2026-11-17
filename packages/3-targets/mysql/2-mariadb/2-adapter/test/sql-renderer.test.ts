import { MysqlSqlRenderer } from '@internal/adapter-mysql/sql-renderer';
import {
  type AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  InsertAst,
  InsertOnConflict,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
  UpdateAst,
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

describe('MariaDB refusals', () => {
  const id = ColumnRef.of('user', 'id');
  const returningId = [ProjectionItem.of('id', id)];
  const user = TableSource.named('user');
  const refusalOf = (ast: AnyQueryAst) => {
    try {
      sqlOf(ast);
      return undefined;
    } catch (error) {
      return { message: Object(error).message, meta: Object(error).meta };
    }
  };

  it('says the adapter does not use INSERT or DELETE … RETURNING, which MariaDB has, and that MariaDB has no UPDATE … RETURNING', () => {
    expect({
      insert: refusalOf(
        InsertAst.into(user)
          .withRows([{ email: ParamRef.of('a@b.c') }])
          .withReturning(returningId),
      ),
      update: refusalOf(
        UpdateAst.table(user)
          .withSet({ email: ParamRef.of('a@b.c') })
          .withReturning(returningId),
      ),
      delete: refusalOf(DeleteAst.from(user).withReturning(returningId)),
    }).toEqual({
      insert: {
        message:
          'The MariaDB adapter does not write INSERT … RETURNING: it reports no returning capability, since MariaDB has no UPDATE … RETURNING, so the ORM reads written rows back with a select',
        meta: { target: 'mariadb', feature: 'returning' },
      },
      update: {
        message: 'MariaDB cannot return the rows an update writes; it has no RETURNING',
        meta: { target: 'mariadb', feature: 'returning' },
      },
      delete: {
        message:
          'The MariaDB adapter does not write DELETE … RETURNING: it reports no returning capability, since MariaDB has no UPDATE … RETURNING, so the ORM reads written rows back with a select',
        meta: { target: 'mariadb', feature: 'returning' },
      },
    });
  });

  it('names MariaDB in a refusal it shares with MySQL', () => {
    expect(
      refusalOf(
        SelectAst.from(user)
          .withProjection([ProjectionItem.of('id', id)])
          .withDistinctOn([id]),
      ),
    ).toEqual({
      message: 'MariaDB has no DISTINCT ON',
      meta: { target: 'mariadb', feature: 'distinct-on' },
    });
  });
});
