\pset format unaligned
\pset fieldsep ' | '
\pset tuples_only on
\set ON_ERROR_STOP off
DROP TABLE IF EXISTS m;
CREATE TABLE m (loc text, label text, sent numeric, stored money);
CREATE OR REPLACE FUNCTION probe(loc text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v numeric;
BEGIN
  PERFORM set_config('lc_monetary', loc, false);
  FOREACH v IN ARRAY ARRAY[1234.5, -1234.5, 0, 0.07, -0.07, 12.505, 1234567890.12, 92233720368547758.07, -92233720368547758.08]::numeric[] LOOP
    INSERT INTO m VALUES (loc, 'v', v, v::money);
  END LOOP;
END $$;
SELECT 'locale', 'label', 'sent', 'text under same locale', 'numeric of stored (locale-free)';
SELECT probe('C');
SELECT probe('POSIX');
SELECT probe('C.UTF-8');
SELECT probe('en_US.UTF-8');
SELECT probe('en_GB.UTF-8');
SELECT probe('de_DE.UTF-8');
SELECT probe('ja_JP.UTF-8');
CREATE OR REPLACE FUNCTION show(loc text) RETURNS TABLE(l text, sent numeric, txt text, num numeric) LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lc_monetary', loc, false);
  RETURN QUERY SELECT m.loc, m.sent, m.stored::text, m.stored::numeric FROM m WHERE m.loc = show.loc;
END $$;
SELECT * FROM show('C');
SELECT * FROM show('POSIX');
SELECT * FROM show('C.UTF-8');
SELECT * FROM show('en_US.UTF-8');
SELECT * FROM show('en_GB.UTF-8');
SELECT * FROM show('de_DE.UTF-8');
SELECT * FROM show('ja_JP.UTF-8');
-- Cross-locale: value written under C, read as text under each locale
SELECT '--- written under C, read under other locales';
CREATE OR REPLACE FUNCTION cross(loc text) RETURNS TABLE(l text, sent numeric, txt text, num numeric) LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lc_monetary', loc, false);
  RETURN QUERY SELECT loc, m.sent, m.stored::text, m.stored::numeric FROM m WHERE m.loc = 'C';
END $$;
SELECT * FROM cross('ja_JP.UTF-8');
SELECT * FROM cross('de_DE.UTF-8');
-- Text input forms
SELECT '--- text input $1,234.56 under each locale, read numeric';
CREATE OR REPLACE FUNCTION tin(loc text, t text) RETURNS TABLE(l text, input text, num numeric, err text) LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lc_monetary', loc, false);
  BEGIN
    RETURN QUERY SELECT loc, t, t::money::numeric, NULL::text;
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT loc, t, NULL::numeric, SQLERRM;
  END;
END $$;
SELECT * FROM tin('C', '$1,234.56');
SELECT * FROM tin('de_DE.UTF-8', '$1,234.56');
SELECT * FROM tin('de_DE.UTF-8', '1234.56');
SELECT * FROM tin('ja_JP.UTF-8', '1234.56');
SELECT * FROM tin('ja_JP.UTF-8', '$1,234.56');
-- Aggregates and json
SELECT '--- json and aggregates under de_DE and ja_JP';
SELECT set_config('lc_monetary', 'de_DE.UTF-8', false);
SELECT to_json(stored), json_build_object('x', stored), sum(stored) over () FROM m WHERE loc = 'C' LIMIT 2;
SELECT set_config('lc_monetary', 'ja_JP.UTF-8', false);
SELECT to_json(stored), json_build_object('x', stored), sum(stored) over () FROM m WHERE loc = 'C' LIMIT 2;
-- Default spelling stored in catalog
SELECT '--- column default spelling';
SELECT set_config('lc_monetary', 'C', false);
DROP TABLE IF EXISTS d;
CREATE TABLE d (a money DEFAULT 12.34, b money DEFAULT '12.34'::money, c money DEFAULT '$12.34');
SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef WHERE adrelid = 'd'::regclass ORDER BY adnum;
SELECT set_config('lc_monetary', 'de_DE.UTF-8', false);
SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef WHERE adrelid = 'd'::regclass ORDER BY adnum;
SELECT set_config('lc_monetary', 'ja_JP.UTF-8', false);
SELECT pg_get_expr(adbin, adrelid) FROM pg_attrdef WHERE adrelid = 'd'::regclass ORDER BY adnum;
SELECT column_default FROM information_schema.columns WHERE table_name = 'd' ORDER BY ordinal_position;
