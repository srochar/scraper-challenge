## Why

La ejecucion actual depende de `--config` y de archivos como `scraper.config.json` para aplicar defaults operativos. Esto agrega una capa de acoplamiento y errores de entorno innecesarios para corridas simples y dificulta operar con comandos explicitos y auditables.

## What Changes

- Eliminar soporte de `--config` como entrada de ejecucion.
- Eliminar carga y validacion de perfiles JSON de runtime (`defaults`, `botJobs`, `botGroups`) para este flujo.
- Mantener configuracion operativa via flags CLI directos (incluyendo `--download-mode`, `--request-*`, `--network-*`, `--log-*`, `--resume`, `--failed-only`).
- Actualizar contratos operativos (scripts/package/docker/docs) para no depender de `scraper.config.json`.
- **BREAKING**: comandos y automatizaciones que usan `--config` o montan `scraper.config.json` dejaran de ser compatibles.

## Capabilities

### New Capabilities
- _None._

### Modified Capabilities
- `jurisprudencia-scraper`: el contrato de configuracion de ejecucion cambia para usar solo parametros CLI directos, removiendo entrada por archivo `--config`.

## Impact

- Codigo afectado principal: `src/runtime/config.ts`, `src/index.ts`, `src/runtime/types.ts`, `src/runtime/dispatcher.ts`.
- Superficie de integracion/documentacion: `README.md`, `docker-compose.yml`, `package.json` (scripts que referencian `--config`).
- Pruebas afectadas: `test/runtimeConfig.test.ts` y cualquier prueba que verifique carga por archivo `scraper.config.json`.
- Impacto operacional: pipelines locales/CI que hoy dependen de `--config` deben migrar a flags directos.
