## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `uv run pytest`, `uv run ruff check .`, `npm test` and `npm run check` pass
- [ ] If the pipeline or config changed: `update --state <name>` ran, `validate` passed, a second run left no diff, and regenerated `docs/data` and `data-raw/manifest.json` are committed with the change
- [ ] If the app changed: `npm run build` was run and `docs/` is committed
- [ ] No state name, abbreviation, FIPS code or zone id as a literal in code
- [ ] Numbers keep their labels (version, units, dollar basis, data status); nothing "not published" is shown as zero; FAF5 and FAF6 are not joined
- [ ] New views are keyboard operable, readable in both themes and at 320 px, and charts have a text alternative
- [ ] Decisions or deviations are in `docs/DECISIONS.md`; no new paid service, backend, Action or runtime CDN
