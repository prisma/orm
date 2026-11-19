\pset format unaligned
\pset fieldsep ' | '
\pset tuples_only on
CREATE OR REPLACE FUNCTION pr(loc text) RETURNS TABLE(l text, pos text, neg text, small text, written_1234_56_read_as_c text) LANGUAGE plpgsql AS $$
DECLARE raw money;
BEGIN
  PERFORM set_config('lc_monetary', loc, false);
  raw := 1234.56::numeric::money;
  l := loc; pos := 1234.56::numeric::money::text; neg := (-1234.56)::numeric::money::text; small := 0.07::numeric::money::text;
  PERFORM set_config('lc_monetary', 'C', false);
  written_1234_56_read_as_c := raw::text;
  RETURN NEXT;
END $$;
SELECT * FROM pr('C');
SELECT * FROM pr('en_US.UTF-8');
SELECT * FROM pr('en_GB.UTF-8');
SELECT * FROM pr('de_DE.UTF-8');
SELECT * FROM pr('ja_JP.UTF-8');
SELECT * FROM pr('ko_KR.UTF-8');
SELECT * FROM pr('ar_KW.UTF-8');
SELECT * FROM pr('es_CL.UTF-8');
SELECT * FROM pr('zh_TW.UTF-8');
SELECT * FROM pr('es_MX.UTF-8');
SELECT * FROM pr('en_AU.UTF-8');
SELECT * FROM pr('en_CA.UTF-8');
SELECT * FROM pr('fr_CA.UTF-8');
SELECT * FROM pr('pt_BR.UTF-8');
SELECT * FROM pr('en_IN.UTF-8');
SELECT * FROM pr('es_CO.UTF-8');
SELECT * FROM pr('hu_HU.UTF-8');
SELECT * FROM pr('is_IS.UTF-8');
SELECT * FROM pr('vi_VN.UTF-8');
SELECT * FROM pr('zh_HK.UTF-8');
SELECT * FROM pr('es_US.UTF-8');
SELECT * FROM pr('en_SG.UTF-8');
SELECT * FROM pr('fr_FR.UTF-8');
SELECT * FROM pr('it_IT.UTF-8');
SELECT * FROM pr('nl_NL.UTF-8');
SELECT * FROM pr('sv_SE.UTF-8');
SELECT * FROM pr('pl_PL.UTF-8');
SELECT * FROM pr('ru_RU.UTF-8');
SELECT * FROM pr('zh_CN.UTF-8');
