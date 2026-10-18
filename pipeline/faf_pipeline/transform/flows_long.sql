-- One (version, scenario, year) slice of the state-touching table in long form.
-- A row is kept when any published measure is positive; NULL means "not published", never 0.
SELECT
  ${faf_version} AS faf_version,
  CAST(${benchmark_year} AS SMALLINT) AS benchmark_year,
  ${data_version} AS data_version,
  ${scenario} AS scenario,
  CAST(${year} AS SMALLINT) AS year,
${key_select}
  ${tons} AS tons_kt,
  ${value} AS value_const_musd,
  ${current_value} AS value_current_musd,
  ${tmiles} AS tmiles_m,
  ${source_file} AS source_file
FROM touching
WHERE greatest(coalesce(${tons}, 0), coalesce(${value}, 0), coalesce(${current_value}, 0), coalesce(${tmiles}, 0)) > 0
ORDER BY ${order_by}
