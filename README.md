# scraping-bot

Scraper en TypeScript para el portal de Jurisprudencia (JSF/RichFaces), usando solo requests HTTP y parsing.

## Requisitos

- Node.js 18+
- npm
- VPN a Peru para el sitio principal

## Instalacion

```bash
npm install
```

## Build y tests

```bash
npm run build
npm test
```

Corrida limpia (borra `runs/` y `output/`, recrea y ejecuta con config):

```bash
npm run scrape:fresh
```

## Ejecucion basica

```bash
npm run scrape -- --bot civil --search civil --max-records 10
```

Parametros utiles:

- `--bot <nombre>`: identificador del bot (default `default`)
- `--runs-dir <path>`: carpeta base de corridas (default `runs`)
- `--run-id <id>`: reutiliza una corrida especifica
- `--base-url <url>`: URL del portal (por defecto jurisprudencia)
- `--search <texto>`: texto de busqueda
- `--max-records <n>`: limite de registros para corrida acotada
- `--max-pages <n>`: limite de paginas de resultados a recorrer (si no se envia, usa heuristica interna)
- `--request-delay-ms <ms>`: pausa fija entre solicitudes de descarga PDF/ZIP (default `0`)
- `--request-jitter-ms <ms>`: jitter aleatorio adicional por solicitud (default `0`)
- `--request-timeout-ms <ms>`: timeout HTTP por solicitud al portal (default `30000`)
- `--output-dir <path>`: override para carpeta de PDFs individuales (default `runs/<bot>/<runId>/artifacts/pdfs`)
- `--result-format <json|csv>`: formato de salida transformada (default `csv`)
- `--data-dir <path>`: override legacy para data de corrida (default `runs/<bot>/<runId>`)
- `--resume`: reanuda desde la corrida activa (`runs/<bot>/latest.json`) o `--run-id`
- `--failed-only`: procesa solo fallidos de la corrida objetivo
- `--log-level <debug|info|warn|error>`: nivel de logs estructurados (default `info`)
- `--log-format <json|pretty>`: salida de consola en JSON o coloreada (default `json`)
- `--log-file <path>`: archivo para persistir logs JSONL (default `runs/<bot>/<runId>/logs.jsonl`)
- `--download-mode <individual|bulk|both>`: modo de descarga de ZIPs (default `individual`)
- `--unzip [true|false]`: descomprime automaticamente cada ZIP descargado en una carpeta hermana (default `false`)
- `--bot-jobs <json>`: lista JSON de jobs multi-bot (se ejecutan en paralelo controlado)
- `--bot-concurrency <n>`: concurrencia de workers para cola multi-bot (default `2`, max `4`, min efectivo `1`)
- `--network-rps <n>`: requests/segundo globales del dispatcher (default `1`)
- `--network-cooldown-ms <ms>`: cooldown base al detectar 429 (default `10000`)
- `--network-cooldown-threshold <n>`: cantidad de 429 en ventana para escalar cooldown (default `3`)
- `--network-cooldown-window-ms <ms>`: ventana de eventos 429 (default `30000`)
- `--network-max-cooldown-ms <ms>`: maximo cooldown global (default `60000`)
- `--network-jitter-ratio <0..1>`: jitter del rate limit global (default `0.2`)
- `--max-consecutive-download-failures <n>`: aborta la corrida si hay `n` fallas de descarga seguidas (`0` desactiva, default `0`)
- `--duplicate-429-window-ms <ms>`: ventana para detectar cluster de `429` por URL PDF canónica (default `30000`)
- `--duplicate-429-threshold <n>`: cantidad de `429` en la ventana para activar guardrail por URL canónica (default `3`)

Nota de pacing: si una descarga individual falla, el bot vuelve a aplicar el mismo pacing (`requestDelayMs` + jitter) y luego espera ~5 segundos adicionales antes de pasar al siguiente registro.

## Artefactos de salida

- `runs/<bot>/<runId>/records.jsonl`: registros extraidos
- `runs/<bot>/<runId>/progress.json`: checkpoint de avance
- `runs/<bot>/<runId>/failed.jsonl`: fallos para reintento
- `runs/<bot>/<runId>/errors.jsonl`: tabla de errores por etapa
- `runs/<bot>/<runId>/logs.jsonl`: logs estructurados persistidos
- `runs/global.logs.jsonl`: log global consolidado de todas las corridas/jobs
- `runs/<bot>/<runId>/artifacts/pdfs/`: PDFs individuales descargados
- `runs/<bot>/<runId>/artifacts/bulk/`: ZIPs de descarga masiva
- `runs/<bot>/<runId>/results/records.json`: salida transformada JSON (si `--result-format json`)
- `runs/<bot>/<runId>/results/records.csv`: salida transformada CSV (si `--result-format csv`)
- `runs/result-global.json`: salida consolidada global JSON en ejecuciones multi-bot (si `--result-format json`)
- `runs/result-global.csv`: salida consolidada global CSV en ejecuciones multi-bot (si `--result-format csv`)
- `runs/<bot>/latest.json`: puntero a la corrida activa/reciente

## Reintento de fallidos

```bash
npm run scrape -- --bot civil --failed-only
```

## Modos de descarga

- `individual`: descarga PDF por cada registro (cuando la pagina expone enlace de resolucion)
- `bulk`: marca seleccionados y descarga ZIP de resoluciones
- `both`: realiza ambos modos en una corrida

En modo `bulk`, la descarga masiva se intenta por cada pagina procesada que tenga registros seleccionables; si una pagina falla o no devuelve ZIP, la corrida continua con las siguientes paginas.

## Orden de resultados transformados

La salida transformada (`records.csv`/`records.json`) mantiene orden deterministico para corridas equivalentes. El criterio es:

1. `bot`
2. `sourcePage`
3. `title`
4. `id`

Ademas, cada registro incluye columnas/campos de procedencia (`bot`, `runId`) para trazabilidad en consolidaciones globales.

Nota: si ves "muchas descargas", probablemente estas en modo `individual` (1 PDF por caso). Si el portal permite seleccionar todo y bajar un solo archivo, usa `--download-mode bulk`.

Ejemplos:

```bash
npm run scrape -- --bot civil --search "civil" --max-records 10 --max-pages 2 --download-mode individual
npm run scrape -- --bot civil --search "civil" --max-records 10 --max-pages 2 --download-mode bulk
npm run scrape -- --bot civil --search "civil" --max-records 10 --max-pages 2 --download-mode both
npm run scrape -- --bot civil --search "civil" --max-records 10 --max-pages 2 --download-mode individual --result-format csv
npm run scrape -- --bot civil --search "civil" --max-records 10 --max-pages 2 --download-mode individual --request-delay-ms 1200 --request-jitter-ms 900
npm run scrape -- --bot civil --search "civil" --max-records 10 --max-pages 2 --download-mode bulk --unzip true
```

## Logging profesional

El scraper emite logs estructurados en JSON por stdout/stderr.

Ejemplo:

```bash
npm run scrape -- --bot civil --search "civil" --max-records 5 --max-pages 2 --log-level debug --log-format pretty
```

Diagnostico 429/duplicados:

- `downloadReason = duplicate_pdf_url_suppressed`: el registro comparte URL PDF canónica con uno ya procesado en la misma corrida y se suprimen reintentos redundantes.
- Campos de contexto clave en logs/errores: `canonicalPdfUrl`, `rateLimitHitsInWindow`, `cooldownMs`, `cooldownMultiplier`, `guardrailActivated`, `duplicateSuppressed`.

## Docker

Build de imagen:

```bash
docker build -t scraping-bot .
```

Ejecucion multi-bot en paralelo controlado (sesion segura por lane) + network queue global:

```bash
docker compose up -d
docker compose logs -f bot-runner
```

## Cola de bots y cola de red

Puedes ejecutar multiples jobs con `--bot-jobs` (JSON por CLI) y controlar concurrencia con `--bot-concurrency`.

`botConcurrency` controla cuantos jobs quedan activos al mismo tiempo. Guardrails:
- Default operativo: `2`
- Minimo efectivo: `1`
- Maximo permitido: `4` (si envias un valor mayor por CLI, el proceso lo acota y emite warning)

`--bot-jobs` por CLI define explicitamente el lote de ejecucion para esa corrida.

Ejemplo local (3 bots con concurrencia 2 y rate limit global compartido):

```bash
npm run scrape -- --bot-jobs "[{\"id\":\"civil\",\"bot\":\"civil\",\"searchTerm\":\"civil\",\"maxPages\":2},{\"id\":\"familia\",\"bot\":\"familia\",\"searchTerm\":\"familia\",\"maxPages\":2},{\"id\":\"impuestos\",\"bot\":\"impuestos\",\"searchTerm\":\"empresarios absuelto evadir impuesto\",\"maxPages\":2}]" --bot-concurrency 2 --network-rps 1 --network-cooldown-ms 10000 --network-cooldown-threshold 3 --network-cooldown-window-ms 30000 --network-jitter-ratio 0.2 --download-mode individual --log-format pretty
```

## Notas

- El portal puede devolver 429; el descargador aplica reintentos con backoff exponencial y jitter.
- El dispatcher de red aplica un limite global de requests y cooldown adaptativo cuando detecta 429.
- En ejecucion concurrente, la red sigue una cola global compartida y serializa operaciones por `sessionKey` para proteger estado JSF.
- Los tests unitarios cubren secuencias simuladas de 429, agotamiento de reintentos y continuidad del procesamiento.
- En ejecucion multi-job, un job se reporta con `success: false` cuando termina con descargas fallidas (`summary.failed > 0`), aunque la corrida haya finalizado sin excepcion fatal.
- En `downloadMode=bulk`, el scraper ejecuta seleccion masiva por pagina y envia el submit final alineado al flujo real del portal (HAR), evitando campos extra que invaliden la seleccion.
- Con `unzip=true`, por cada `*.zip` guardado en `runs/<bot>/<runId>/artifacts/bulk/` se crea una carpeta de extraccion con el mismo nombre base.
- Diagnostico 429/duplicados:
  - reason `duplicate_pdf_url_suppressed`: el registro se resolvio como duplicado de una URL PDF canónica ya vista en la misma corrida y se suprimieron reintentos redundantes.
  - Campos de contexto relevantes en logs/errores: `canonicalPdfUrl`, `rateLimitHitsInWindow`, `cooldownMs`, `cooldownMultiplier`, `guardrailActivated`, `duplicateSuppressed`.
