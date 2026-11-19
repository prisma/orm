\pset format unaligned
\pset fieldsep '|'
\pset tuples_only on
CREATE TEMP TABLE locs (l text);
\copy locs FROM '/tmp/locs.txt'
CREATE OR REPLACE FUNCTION scan() RETURNS TABLE(l text, sent numeric, printed text, raw_as_c text) LANGUAGE plpgsql AS $$
DECLARE r record; v numeric; m money;
BEGIN
  FOR r IN SELECT locs.l FROM locs LOOP
    BEGIN
      PERFORM set_config('lc_monetary', r.l, false);
    EXCEPTION WHEN others THEN CONTINUE;
    END;
    FOREACH v IN ARRAY ARRAY[0, 0.07, 12.34, 1234.56, -1234.56, 1234567.89, 100]::numeric[] LOOP
      PERFORM set_config('lc_monetary', r.l, false);
      m := v::money;
      l := r.l; sent := v; printed := m::text;
      PERFORM set_config('lc_monetary', 'C', false);
      raw_as_c := m::text;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END $$;
SELECT * FROM scan();
