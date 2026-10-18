# Contributing

Thanks for helping. This project turns public FAF data into something people can read, so its main promise is **honesty about the data**. Most review comments will be about that, not about style.

## Ground rules (these are decisions, not preferences)

- **No paid services, no backend, no GitHub Actions, no runtime CDNs.** Everything is static files on GitHub Pages. Self-host libraries and binaries through the build. If you think one of these is needed, open an issue and explain; do not just add it.
- **Real sources only.** The source of record is the BTS/FHWA/ORNL/Census files, not repackagings or APIs. Do not scrape web tools.
- **Verify before trusting.** Never invent column names, URLs, units or release dates. Profile the real file first (`duckdb`), then write the column map. If something cannot be confirmed, say so in the code comment, the dictionary or `docs/DECISIONS.md`.
- **No state literals.** The state's name, abbreviation, FIPS code and zone ids may appear only in `config/states/<name>.yml` (and generated data). `validate` and a test scan the code for them.
- **Keep the UI data-honest:** label version, units, dollar basis, data status and "model, not measured" wherever a number appears; "not published" is never shown as zero; never connect FAF5 and FAF6 in one series; no rankings, no scores, no predictions beyond published scenarios.
- **Unknown input fails the build.** Added columns, unclassified years or missing codes must stop `update` with a clear message; do not coerce or guess.
- **Deterministic outputs.** Re-running on unchanged inputs must give byte-identical files (explicit `ORDER BY`, no timestamps). A second `update` should leave no git diff.

## Setup

```
cd pipeline && uv run pytest            # needs uv; DuckDB fetches its spatial/excel extensions on first use
cd web && npm install && npm test && npm run check
```

Run both test suites and `uv run ruff check .` before opening a pull request. If you touched the pipeline or the config, also run `uv run python -m faf_pipeline update --state utah` and make sure `validate` passes and the second run produces no diff (commit regenerated `docs/data` and `data-raw/manifest.json` together with the change that caused them). If you touched the app, run `npm run build` and commit `docs/`.

## Where things go

- **A new column or release:** column map in `pipeline/faf_pipeline/schemas/` (use `build --scaffold-map`), classification in `config/sources.yml`, and an entry in `schemas/dictionary.yml` (label, description, unit, caveat; the build fails without it).
- **A new check:** `pipeline/faf_pipeline/validate.py` (or `validate_extra.py`), with a test using a tiny fixture in `pipeline/tests/`. Fixtures use a fictional state (`Testland`, FIPS 99), never a real one.
- **A new control or chart:** state belongs in the URL (`web/src/lib/urlstate.ts`, with a test), queries are built in `web/src/lib/sql.ts` (values come from validated codes, never from raw strings), and the numbers go through `format.ts`. Every chart needs a text alternative (see `DataTable.svelte`).
- **A decision or deviation from `HANDOFF.md`:** add a dated entry to `docs/DECISIONS.md`.

## Accessibility checklist

Keyboard reachable with a visible focus ring; labeled controls; no information by color alone (use shape, text or position too); text contrast at least 4.5:1 in both themes; targets at least 24 by 24 px; works at 320 px wide and with reduced motion. The repository's checks were run with axe-core (WCAG 2.2 AA); please re-run an equivalent on any new view.

## Reporting a data problem

Open an issue using the data question template. Include the URL from the address bar (it holds the whole view), the FAF release and year, what you expected and what you saw, and a link to the original FAF file or table if you compared. If the discrepancy is in the source, we will document it rather than "fix" it.

## Conduct

Be kind and specific. Assume good faith, argue with evidence, and keep personal data (yours or anyone's) out of issues and commits.
