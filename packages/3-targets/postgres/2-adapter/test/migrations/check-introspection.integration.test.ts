import { PostgresDatabaseSchemaNode } from '@internal/target-postgres/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

/**
 * Every expression asserted below is the `pg_get_expr(conbin, conrelid)` output
 * observed from the database this suite runs against, not a hand-written guess.
 * Postgres reprints predicates in its own normalized form — adding casts,
 * re-parenthesizing — which is exactly why introspection stores the body
 * verbatim and never parses it.
 */
describe('check-constraint introspection', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  async function checksFor(tableName: string) {
    const schema = await familyInstance.introspect({ driver: driver! });
    PostgresDatabaseSchemaNode.assert(schema);
    return schema.namespaces['public']?.tables[tableName]?.checks ?? [];
  }

  it('captures a free-form predicate, a composite AND, and a NOT VALID constraint', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(
      `CREATE TABLE t (
           id int,
           price numeric,
           a int,
           b text,
           CONSTRAINT t_price_positive CHECK (price > 0),
           CONSTRAINT t_a_and_b CHECK (a > 0 AND b <> '')
         )`,
    );
    await driver!.query('ALTER TABLE t ADD CONSTRAINT t_id_large CHECK (id > 100) NOT VALID');

    const checks = await checksFor('t');

    expect(
      checks
        .map((c) => ({ name: c.name, prefix: c.prefix, expression: c.expression }))
        .sort((x, y) => (x.name < y.name ? -1 : 1)),
    ).toEqual([
      { name: 't_a_and_b', prefix: undefined, expression: `((a > 0) AND (b <> ''::text))` },
      // The NOT VALID suffix lives on the constraint, not the predicate, so
      // pg_get_expr yields a clean body — no suffix contamination.
      { name: 't_id_large', prefix: undefined, expression: '(id > 100)' },
      { name: 't_price_positive', prefix: undefined, expression: '(price > (0)::numeric)' },
    ]);
  });

  it('claims wire naming for a wire-shaped constraint name', { timeout: testTimeout }, async () => {
    await driver!.query(
      `CREATE TABLE t (
           role text,
           CONSTRAINT t_role_check_0a1b2c3d CHECK (role IN ('user'))
         )`,
    );

    const checks = await checksFor('t');

    expect(checks.map((c) => ({ name: c.name, prefix: c.prefix }))).toEqual([
      { name: 't_role_check_0a1b2c3d', prefix: 't_role_check' },
    ]);
  });

  it('a varchar membership check round-trips as an opaque reprint', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(
      `CREATE TABLE t (
           status varchar(20),
           CONSTRAINT t_status_check CHECK (status IN ('a', 'b'))
         )`,
    );

    const checks = await checksFor('t');

    // This reprint is what the deleted predicate parser could not read.
    expect(checks.map((c) => c.expression)).toEqual([
      `((status)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))`,
    ]);
  });

  it('pins every membership reprint shape the domain-enum harvest reads', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(
      `CREATE TABLE t (
           role text,
           status varchar(20),
           tags text[],
           surname text,
           CONSTRAINT t_array_contains CHECK ("tags"::text[] <@ ARRAY['user', 'admin']::text[]),
           CONSTRAINT t_quoted_member CHECK (surname IN ('O''Brien', 'plain')),
           CONSTRAINT t_text_many CHECK (role IN ('user', 'admin')),
           CONSTRAINT t_text_one CHECK (role IN ('user')),
           CONSTRAINT t_varchar_many CHECK (status IN ('a', 'b')),
           CONSTRAINT t_varchar_one CHECK (status IN ('a'))
         )`,
    );

    const checks = await checksFor('t');

    // A one-member IN collapses to bare `=` — no ANY, no ARRAY. The `<@`
    // containment is created exactly as authoring renders a list-typed domain
    // enum; the reprint drops the column cast and folds the array cast into
    // per-element casts. A doubled quote inside a value stays doubled.
    //
    // These literals are what Postgres itself prints, not what was authored,
    // and they are the reference the unit-test fixtures elsewhere are written
    // against. Postgres's predicate printer is version-dependent, so a change
    // here on an upgrade is a real signal, not noise to be re-recorded.
    //
    // What this suite proves is one version: it runs on the PGlite server
    // `@repo/test-utils` starts, so these are that server's 17.x output. Every
    // shape was also run by hand against 15.18 — the supported floor — and was
    // byte-identical, which is why nothing downstream branches on version. That
    // second run is not reproducible from this suite, so treat it as a recorded
    // observation rather than a guarantee CI re-establishes.
    expect(
      checks
        .map((c) => ({ name: c.name, expression: c.expression }))
        .sort((x, y) => (x.name < y.name ? -1 : 1)),
    ).toEqual([
      { name: 't_array_contains', expression: `(tags <@ ARRAY['user'::text, 'admin'::text])` },
      {
        name: 't_quoted_member',
        expression: `(surname = ANY (ARRAY['O''Brien'::text, 'plain'::text]))`,
      },
      { name: 't_text_many', expression: `(role = ANY (ARRAY['user'::text, 'admin'::text]))` },
      { name: 't_text_one', expression: `(role = 'user'::text)` },
      {
        name: 't_varchar_many',
        expression: `((status)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))`,
      },
      { name: 't_varchar_one', expression: `((status)::text = 'a'::text)` },
    ]);
  });

  it('a partitioned table yields one node for the parent and none for the partition', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(
      `CREATE TABLE t_part (
           id int,
           region text,
           CONSTRAINT t_part_region_check CHECK (region <> '')
         ) PARTITION BY LIST (region)`,
    );
    await driver!.query(`CREATE TABLE t_part_a PARTITION OF t_part FOR VALUES IN ('a')`);

    // The partition inherits the constraint (conislocal = false there), so
    // without the conislocal filter the same constraint would surface twice.
    expect((await checksFor('t_part')).map((c) => c.name)).toEqual(['t_part_region_check']);
    expect(await checksFor('t_part_a')).toEqual([]);
  });

  it('an inheriting child yields no node for the constraint it inherits', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(
      'CREATE TABLE t_parent (id int, CONSTRAINT t_parent_id_check CHECK (id > 0))',
    );
    await driver!.query('CREATE TABLE t_child () INHERITS (t_parent)');

    expect((await checksFor('t_parent')).map((c) => c.name)).toEqual(['t_parent_id_check']);
    expect(await checksFor('t_child')).toEqual([]);
  });

  it('a domain constraint produces no check node on a table using the domain', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query('CREATE DOMAIN pos_int AS int CHECK (VALUE > 0)');
    await driver!.query('CREATE TABLE t (id int, n pos_int)');

    // A domain check is contype = 'c' with conrelid = 0: it belongs to the
    // type, not to any table.
    expect(await checksFor('t')).toEqual([]);
  });
});
