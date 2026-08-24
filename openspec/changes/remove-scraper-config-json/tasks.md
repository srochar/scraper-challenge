## 1. Runtime CLI-only contract

- [x] 1.1 Remove runtime file-config loading (`--config`) from startup flow and verify invoking `npm run scrape -- --config any.json` fails fast with a clear unsupported-flag/config message.
- [x] 1.2 Refactor runtime config resolution to rely on direct CLI flags plus internal defaults and verify `npm run scrape -- --bot civil --search civil --max-pages 1 --max-records 1` builds config and starts correctly.
- [x] 1.3 Keep `downloadMode` behavior unchanged while removing file-config dependencies and verify unit coverage still passes for `individual`, `bulk`, and `both` run paths.

## 2. Remove file-config artifacts and references

- [x] 2.1 Delete repo-level `scraper.config.json` artifacts from active workflow and verify no runtime code path references `scraper.config.json` or `--config`.
- [x] 2.2 Update `package.json` operational scripts to CLI-only invocations and verify `npm run scrape:fresh` executes without requiring `--config`.
- [x] 2.3 Update `docker-compose.yml` command/volume definitions to avoid mounting runtime config files and verify `docker compose config` renders successfully.

## 3. Tests and documentation alignment

- [x] 3.1 Replace file-config specific tests with CLI-only contract tests and verify `npm test` passes.
- [x] 3.2 Update `README.md` to remove `--config` guidance and file-profile sections while preserving direct flag usage docs, then verify command examples are internally consistent.
- [x] 3.3 Run `npm run build` and verify TypeScript compilation succeeds after removing file-config related exports/imports.
