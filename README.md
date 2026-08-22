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
- `--request-delay-ms <ms>`: pausa fija entre solicitudes de descarga PDF/ZIP (default `0`)
- `--request-jitter-ms <ms>`: jitter aleatorio adicional por solicitud (default `0`)
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
- `--config <path>`: archivo JSON con defaults, `botJobs` y/o `botGroups` para no repetir flags largos
- `--bot-jobs <json>`: lista JSON de jobs multi-bot (se ejecutan secuencialmente, uno por vez)
- `--network-rps <n>`: requests/segundo globales del dispatcher (default `1`)
- `--network-cooldown-ms <ms>`: cooldown base al detectar 429 (default `10000`)
- `--network-cooldown-threshold <n>`: cantidad de 429 en ventana para escalar cooldown (default `3`)
- `--network-cooldown-window-ms <ms>`: ventana de eventos 429 (default `30000`)
- `--network-max-cooldown-ms <ms>`: maximo cooldown global (default `60000`)
- `--network-jitter-ratio <0..1>`: jitter del rate limit global (default `0.2`)
- `--max-consecutive-download-failures <n>`: aborta la corrida si hay `n` fallas de descarga seguidas (`0` desactiva, default `0`)

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
- `runs/<bot>/latest.json`: puntero a la corrida activa/reciente

## Reintento de fallidos

```bash
npm run scrape -- --bot civil --failed-only
```

## Modos de descarga

- `individual`: descarga PDF por cada registro (cuando la pagina expone enlace de resolucion)
- `bulk`: marca seleccionados y descarga ZIP de resoluciones
- `both`: realiza ambos modos en una corrida

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

## Docker

Build de imagen:

```bash
docker build -t scraping-bot .
```

Ejecucion multi-bot secuencial (una sesion por job) + network queue global:

```bash
docker compose up -d
docker compose logs -f bot-runner
```

## Cola de bots y cola de red

Recomendado: usar archivo de configuracion para no pasar `--bot-jobs` y otros flags largos en cada ejecucion.

Archivo ejemplo: `scraper.config.json`

```json
{
  "defaults": {
    "botConcurrency": 3,
    "networkRps": 1,
    "networkCooldownMs": 10000,
    "networkCooldownThreshold": 3,
    "networkCooldownWindowMs": 30000,
    "networkJitterRatio": 0.2,
    "requestDelayMs": 1200,
    "requestJitterMs": 900,
    "downloadMode": "individual",
    "resultFormat": "csv",
    "logFormat": "pretty",
    "logLevel": "info"
  },
  "botGroups": [
    {
      "bot": "civil",
      "maxPages": 2,
      "searchTerms": ["herencia", "derecho a vivienda"]
    },
    {
      "bot": "familia",
      "maxPages": 2,
      "searchTerms": ["tenencia", "alimentos"]
    },
    {
      "bot": "impuestos",
      "maxPages": 2,
      "searchTerms": [
        { "id": "impuestos-absueltos", "term": "empresarios absuelto evadir impuesto" }
      ]
    }
  ]
}
```

Ejecucion con config:

```bash
npm run scrape -- --config scraper.config.json
```

Prioridad de configuracion:
- CLI (`--network-rps`, etc.)
- `defaults` en `--config`
- default interno del programa

`botGroups` se expande automaticamente a jobs. Si defines ambos, se ejecutan `botJobs` + `botGroups`.

`--bot-jobs` por CLI (si se pasa) reemplaza todo lo del archivo para esa ejecucion.

Ejemplo local (3 bots en cola con rate limit global):

```bash
npm run scrape -- --bot-jobs "[{\"id\":\"civil\",\"bot\":\"civil\",\"searchTerm\":\"civil\",\"maxPages\":2},{\"id\":\"familia\",\"bot\":\"familia\",\"searchTerm\":\"familia\",\"maxPages\":2},{\"id\":\"impuestos\",\"bot\":\"impuestos\",\"searchTerm\":\"empresarios absuelto evadir impuesto\",\"maxPages\":2}]" --network-rps 1 --network-cooldown-ms 10000 --network-cooldown-threshold 3 --network-cooldown-window-ms 30000 --network-jitter-ratio 0.2 --download-mode individual --log-format pretty
```

## Notas

- El portal puede devolver 429; el descargador aplica reintentos con backoff exponencial y jitter.
- El dispatcher de red aplica un limite global de requests y cooldown adaptativo cuando detecta 429.
- Los tests unitarios cubren secuencias simuladas de 429, agotamiento de reintentos y continuidad del procesamiento.
