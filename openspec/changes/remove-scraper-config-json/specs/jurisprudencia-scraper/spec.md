## ADDED Requirements

### Requirement: CLI-only runtime configuration
The scraper runtime SHALL accept operational configuration exclusively from direct CLI flags and internal defaults, and MUST NOT require or parse external JSON configuration files for run setup.

#### Scenario: Single-run execution with direct flags
- **WHEN** operators invoke the scraper with supported CLI flags such as `--bot`, `--search`, `--max-pages`, `--download-mode`, and pacing/logging flags
- **THEN** the scraper starts and resolves runtime settings from those flags plus internal defaults without reading a runtime config file

#### Scenario: Legacy file-config flag rejected
- **WHEN** operators pass the legacy `--config` flag
- **THEN** the scraper fails fast with a descriptive usage/configuration error indicating that file-based runtime config is no longer supported
