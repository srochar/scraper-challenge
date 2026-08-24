## Context

El flujo de arranque actual mezcla dos fuentes de configuracion: flags CLI directos y archivo JSON via `--config` (cargado por `loadRuntimeConfig`). Esa capa agrega validaciones, precedence rules y rutas operativas adicionales (`defaults`, `botJobs`, `botGroups`) que no son necesarias para el objetivo actual del proyecto. Ver `proposal.md` para motivacion y alcance.

## Goals / Non-Goals

**Goals:**
- Eliminar el soporte de configuracion por archivo `scraper.config.json` y el flag `--config` en el runtime.
- Mantener intacto el soporte de configuracion por flags CLI existentes, incluyendo `downloadMode` y parametros de resiliencia.
- Simplificar el arranque para que la resolucion de parametros sea directa: CLI + defaults internos.
- Ajustar documentacion y comandos operativos para reflejar el nuevo contrato CLI-only.

**Non-Goals:**
- No cambiar la semantica de scraping, parsing, descarga o persistencia de artefactos.
- No redefinir `downloadMode` (`individual|bulk|both`) ni sus rutas de ejecucion.
- No introducir nuevos formatos o nuevas fuentes de configuracion.

## Decisions

### 1) Retirar `--config` del bootstrap principal
- **Decision:** `src/index.ts` deja de cargar runtime config file y deja de usar `runtimeConfig.defaults`.
- **Rationale:** elimina complejidad de branching y dependencia de archivos externos para ejecutar.
- **Alternatives considered:**
  - Mantener `--config` pero deprecado: rechazado porque mantiene deuda y rutas dobles.
  - Mantener soporte parcial solo para `defaults`: rechazado porque conserva ambiguedad de precedence.

### 2) Resolver parametros solo con flags + defaults internos
- **Decision:** `buildConfigFromArgs` conserva resolucion por CLI con fallbacks internos; se elimina lectura/validacion de JSON runtime.
- **Rationale:** comportamiento predecible y auditable por comando.
- **Alternatives considered:**
  - Variables de entorno como reemplazo: fuera de alcance de este cambio.

### 3) Eliminar dependencias de artifact config en scripts operativos
- **Decision:** actualizar `package.json` scripts y `docker-compose.yml` para no pasar ni montar `scraper.config.json`.
- **Rationale:** evitar comandos rotos y alinear operaciones con el nuevo contrato.
- **Alternatives considered:**
  - Mantener montaje del archivo sin uso: rechazado por confuso y propenso a errores.

### 4) Preservar capacidades funcionales no relacionadas
- **Decision:** conservar banderas de run (`--download-mode`, `--resume`, `--failed-only`, `--network-*`, `--request-*`, `--log-*`).
- **Rationale:** el cambio es de fuente de configuracion, no de capacidad funcional del scraper.

## Risks / Trade-offs

- **[Riesgo]** Automatizaciones existentes que usan `--config` fallaran inmediatamente.  
  **Mitigation:** actualizar ejemplos/documentacion y comandos de contenedor en el mismo cambio.

- **[Trade-off]** Se pierde conveniencia de perfiles prearmados en archivo.  
  **Mitigation:** documentar comandos CLI equivalentes y mantener defaults internos razonables.

- **[Riesgo]** Cobertura de tests queda desalineada al remover pruebas de config-file parsing.  
  **Mitigation:** sustituir por pruebas de resolucion CLI-only y de error explicito al detectar `--config`.

## Migration Plan

1. Remover uso de `--config` del arranque y capa runtime relacionada.
2. Ajustar wrappers operativos (`npm` scripts y compose) a flags directos.
3. Eliminar archivos `scraper.config*.json` del flujo activo.
4. Actualizar README para contrato CLI-only.
5. Ejecutar suite de pruebas para validar no regresion funcional.

Rollback: reintroducir `--config` en bootstrap y restaurar parser/validadores de runtime config file junto con scripts/docs previos.

## Open Questions

Ninguna para este alcance.
