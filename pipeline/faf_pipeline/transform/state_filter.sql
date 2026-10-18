-- Read one wide FAF CSV, rename/cast to canonical columns, keep only rows that touch the state.
CREATE OR REPLACE TABLE touching AS
SELECT
${select_list}
FROM read_csv(${csv_path}, all_varchar = true, header = true, delim = ',')
WHERE ${where};
