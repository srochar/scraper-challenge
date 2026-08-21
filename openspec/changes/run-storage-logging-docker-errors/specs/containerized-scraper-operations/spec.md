## Purpose

Define container runtime behavior for operating multiple scraper bot profiles concurrently with isolated outputs and repeatable command contracts.

## ADDED Requirements

### Requirement: Multi-bot container composition
The project SHALL provide container orchestration definitions that run multiple named scraper bot services from a shared image.

#### Scenario: Concurrent bot services
- **WHEN** operators start the compose stack
- **THEN** services for configured bots (including `civil`, `familia`, and `robo`) start with independent runtime arguments

#### Scenario: Shared image with distinct bot configuration
- **WHEN** multiple bot services are defined
- **THEN** each service uses the same application image but supplies bot-specific command flags and output scopes

### Requirement: Isolated persistent outputs in containers
Each bot service SHALL persist run data to isolated directories so data from one bot does not overwrite another.

#### Scenario: Bot output isolation
- **WHEN** two bot services execute in parallel
- **THEN** each service writes run artifacts to separate mounted paths partitioned by bot identity

### Requirement: Containerized command reproducibility
The container image SHALL expose a deterministic command entrypoint for invoking scraper runs with CLI flags.

#### Scenario: Default container command
- **WHEN** operators launch a bot service without overriding command
- **THEN** the container executes the scraper process with the configured bot profile and exits with the scraper status code
