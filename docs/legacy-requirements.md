# Notas operativas consolidadas

Este archivo reemplaza notas sueltas de trabajo rapido y resume el comportamiento esperado del scraper.

## Flujo individual

- Ejecutar busqueda en el portal.
- Parsear resultados por pagina y extraer metadata completa por item.
- Descargar resolucion PDF por registro cuando exista enlace.
- Respetar limites de paginacion segun configuracion.

## Flujo grupal (bulk)

- Ejecutar busqueda y parsear resultados por pagina.
- Seleccionar registros visibles de la pagina actual.
- Disparar descarga ZIP masiva para esa pagina.
- Continuar con la siguiente pagina aunque una falle.

## Artefactos esperados por corrida

- `artifacts/pdfs/`: descargas individuales.
- `artifacts/bulk/`: ZIPs por pagina (y descompresion opcional).
- `results/records.csv` o `results/records.json`: salida transformada por bot/corrida.
- `runs/result-global.csv` o `runs/result-global.json`: consolidado global multi-bot.
