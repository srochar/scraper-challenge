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
- `--request-delay-ms <ms>`: pausa fija entre solicitudes de descarga/ZIP (default `0`)
- `--request-jitter-ms <ms>`: jitter aleatorio adicional por solicitud (default `0`)
- `--output-dir <path>`: override legacy para carpeta de PDFs (default `runs/<bot>/<runId>/artifacts/pdfs`)
- `--data-dir <path>`: override legacy para data de corrida (default `runs/<bot>/<runId>`)
- `--resume`: reanuda desde la corrida activa (`runs/<bot>/latest.json`) o `--run-id`
- `--failed-only`: procesa solo fallidos de la corrida objetivo
- `--log-level <debug|info|warn|error>`: nivel de logs estructurados (default `info`)
- `--log-format <json|pretty>`: salida de consola en JSON o coloreada (default `json`)
- `--log-file <path>`: archivo para persistir logs JSONL (default `runs/<bot>/<runId>/logs.jsonl`)
- `--download-mode <individual|bulk|both>`: modo de descarga de PDFs (default `individual`)

## Artefactos de salida

- `runs/<bot>/<runId>/records.jsonl`: registros extraidos
- `runs/<bot>/<runId>/progress.json`: checkpoint de avance
- `runs/<bot>/<runId>/failed.jsonl`: fallos para reintento
- `runs/<bot>/<runId>/errors.jsonl`: tabla de errores por etapa
- `runs/<bot>/<runId>/logs.jsonl`: logs estructurados persistidos
- `runs/<bot>/<runId>/artifacts/pdfs/`: PDFs descargados
- `runs/<bot>/<runId>/artifacts/bulk/`: ZIPs de descarga masiva
- `runs/<bot>/latest.json`: puntero a la corrida activa/reciente

## Reintento de fallidos

```bash
npm run scrape -- --bot civil --failed-only
```

## Modos de descarga

- `individual`: descarga PDF por cada registro (`ServletDescarga?uuid=...`)
- `bulk`: marca seleccionados y descarga ZIP de resoluciones
- `both`: realiza ambos modos en una corrida

Ejemplos:

```bash
npm run scrape -- --bot civil --search "civil" --max-records 10 --max-pages 2 --download-mode individual
npm run scrape -- --bot civil --search "civil" --max-records 10 --max-pages 2 --download-mode bulk
npm run scrape -- --bot civil --search "civil" --max-records 10 --max-pages 2 --download-mode both
npm run scrape -- --bot civil --search "civil" --max-records 10 --max-pages 2 --download-mode individual --request-delay-ms 1200 --request-jitter-ms 900
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

Ejecucion multi-bot:

```bash
docker compose up -d
docker compose logs -f bot-civil
```

## Notas

- El portal puede devolver 429; el descargador aplica reintentos con backoff exponencial y jitter.
- Los tests unitarios cubren secuencias simuladas de 429, agotamiento de reintentos y continuidad del procesamiento.
