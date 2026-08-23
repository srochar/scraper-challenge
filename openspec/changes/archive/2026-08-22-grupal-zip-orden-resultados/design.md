## Context

El flujo actual ya soporta modos de descarga `individual`, `bulk` y `both`, pero los criterios operativos de `docs/legacy-requirements.md` requieren mayor precision en tres puntos: (1) comportamiento grupal por pagina con continuidad de paginacion, (2) orden de entrega de resultados transformados, y (3) consolidacion global de resultados multi-bot. Ver `proposal.md` (Why) para la motivacion de negocio.

Restricciones relevantes:
- El portal JSF/RichFaces mantiene estado por sesion y ViewState en navegacion y paginacion.
- El flujo bulk depende de seleccion por controles dinamicos en cada pagina.
- La salida debe mantener separacion entre binarios (PDF/ZIP) y datasets transformados.
- El proyecto ya usa almacenamiento por corrida (`runs/<bot>/<runId>`) y cola multi-bot secuencial.

## Goals / Non-Goals

**Goals:**
- Definir un flujo grupal robusto por pagina que seleccione casos visibles, descargue ZIP y continue a la siguiente pagina.
- Establecer una politica de orden deterministica para `records.csv` y `records.json`.
- Definir el contrato de salida global consolidada (`result-global.csv` o `result-global.json`) para ejecuciones multi-bot.
- Mantener trazabilidad por origen (bot, runId, pagina, estado de descarga) en datasets consolidados.

**Non-Goals:**
- Reescribir la estrategia de sesion o transporte HTTP del cliente del portal.
- Cambiar el modelo de resiliencia base (retry/backoff) salvo ajustes puntuales de compatibilidad con flujo grupal.
- Introducir paralelismo nuevo entre bots; la consolidacion aplica al flujo multi-bot ya existente.

## Decisions

1. **Group mode page-scoped semantics**

   - Decision: tratar cada pagina como unidad de descarga grupal; seleccionar registros visibles de la pagina activa, solicitar ZIP, registrar outcome y continuar.
   - Rationale: coincide con comportamiento esperado en `docs/legacy-requirements.md` y reduce acoplamiento a supuestos de indices globales.
   - Alternatives considered:
     - Un unico bulk ZIP al final de toda la corrida: rechazado porque el portal puede requerir estado/paginacion incremental.
     - Mantener heuristicas actuales de indices fijos: rechazado por fragilidad ante cambios de estructura del portal.

2. **Deterministic result ordering contract**

   - Decision: definir orden estable para salida transformada basado en campos observables y comparables (por ejemplo: bot, sourcePage, posicion relativa, id estable), independiente del formato de salida.
   - Rationale: evita variaciones entre corridas equivalentes y simplifica comparaciones operativas.
   - Alternatives considered:
     - Confiar solo en orden natural de procesamiento: rechazado por sensibilidad a cambios internos.
     - Orden configurable libre por usuario en esta iteracion: diferido para mantener alcance acotado.

3. **Global transformed result artifact**

   - Decision: agregar un artefacto global al cierre multi-bot que consolide registros transformados de todos los bots, sin eliminar resultados por corrida.
   - Rationale: `docs/legacy-requirements.md` pide conteo/consolidacion global y mantener artefactos por bot en paralelo.
   - Alternatives considered:
     - Mover toda salida solo a global: rechazado porque pierde aislamiento por corrida y complica depuracion.
     - Consolidar solo resumen y no registros: rechazado porque no satisface necesidad de dataset global.

4. **Schema-compatible enrichment for provenance**

   - Decision: enriquecer registros transformados con metadatos minimos de procedencia (bot/run) al consolidar globalmente.
   - Rationale: permite auditoria y reintento dirigido sin re-parsear artefactos locales.
   - Alternatives considered:
     - Mantener esquema local sin campos de origen en global: rechazado por ambiguedad en analisis multi-bot.

## Risks / Trade-offs

- [Risk] Selectores bulk del portal cambian y reducen cobertura de seleccion por pagina. -> Mitigation: basar seleccion en controles detectados dinamicamente y registrar metricas de seleccion por pagina.
- [Risk] Definir un orden estable puede diferir del orden visual del portal en casos limite. -> Mitigation: documentar la politica y conservar campos de pagina/posicion para trazabilidad.
- [Risk] Consolidacion global puede duplicar registros si se reusa `runId` o reintentos sin deduplicacion clara. -> Mitigation: incluir claves de procedencia y estrategia de dedupe deterministica al consolidar.
- [Trade-off] Mantener resultados locales + global incrementa almacenamiento, pero mejora observabilidad y consumo downstream.

## Migration Plan

1. Formalizar contrato de comportamiento grupal por pagina en capa de especificacion y pruebas.
2. Introducir politica de orden deterministica en la etapa de serializacion transformada.
3. Definir e incorporar pipeline de consolidacion global para ejecuciones multi-bot.
4. Actualizar documentacion operativa para rutas de salida (`artifacts/` por bot + `result-global.*`).
5. Validar con corrida acotada multi-bot que preserve paginacion, descargas y consistencia de orden.

Rollback strategy:
- Desactivar consolidacion global y volver al orden previo de serializacion, conservando flujo local por bot sin cambios estructurales en artefactos historicos.
