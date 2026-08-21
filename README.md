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

## Artefactos de salida

- `data/records.jsonl`: registros extraidos
- `data/progress.json`: checkpoint de avance
- `data/failed.jsonl`: fallos de descarga para reintento
- `output/pdfs/`: PDFs descargados

## Reintento de fallidos

```bash
npm run scrape -- --failed-only
```

## Notas

- El portal puede devolver 429; el descargador aplica reintentos con backoff exponencial y jitter.
- Los tests unitarios cubren secuencias simuladas de 429, agotamiento de reintentos y continuidad del procesamiento.
