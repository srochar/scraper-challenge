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
npm run scrape -- --search civil --max-records 10
```

Parametros utiles:

- `--base-url <url>`: URL del portal (por defecto jurisprudencia)
- `--search <texto>`: texto de busqueda
- `--max-records <n>`: limite de registros para corrida acotada
- `--output-dir <path>`: carpeta de PDFs (por defecto `output/pdfs`)
- `--data-dir <path>`: carpeta de estado y data (por defecto `data`)
- `--resume`: reanuda desde `data/progress.json`
- `--failed-only`: procesa solo fallidos registrados en `data/failed.jsonl`
- `--log-level <debug|info|warn|error>`: nivel de logs estructurados (default `info`)
- `--log-file <path>`: archivo opcional para persistir logs JSONL
- `--download-mode <individual|bulk|both>`: modo de descarga de PDFs (default `individual`)

## Artefactos de salida

- `data/records.jsonl`: registros extraidos
- `data/progress.json`: checkpoint de avance
- `data/failed.jsonl`: fallos de descarga para reintento
- `output/pdfs/`: PDFs descargados

## Reintento de fallidos

```bash
npm run scrape -- --failed-only
```

## Modos de descarga

- `individual`: descarga PDF por cada registro (`ServletDescarga?uuid=...`)
- `bulk`: marca seleccionados y descarga ZIP de resoluciones
- `both`: realiza ambos modos en una corrida

Ejemplos:

```bash
npm run scrape -- --search "civil" --max-records 10 --max-pages 2 --download-mode individual
npm run scrape -- --search "civil" --max-records 10 --max-pages 2 --download-mode bulk
npm run scrape -- --search "civil" --max-records 10 --max-pages 2 --download-mode both
```

## Logging profesional

El scraper emite logs estructurados en JSON por stdout/stderr.

Ejemplo:

```bash
npm run scrape -- --search "civil" --max-records 5 --max-pages 2 --log-level debug --log-file data/scraper.log.jsonl
```

## Notas

- El portal puede devolver 429; el descargador aplica reintentos con backoff exponencial y jitter.
- Los tests unitarios cubren secuencias simuladas de 429, agotamiento de reintentos y continuidad del procesamiento.
