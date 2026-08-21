export function toSpanishErrorMessage(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input);

  if (raw.includes("ViewExpiredException")) {
    return "La sesion del portal expiro (ViewExpiredException).";
  }

  const statusMatch = raw.match(/Request failed with status code\s+(\d{3})/i);
  if (statusMatch?.[1]) {
    return `La solicitud fallo con codigo de estado ${statusMatch[1]}.`;
  }

  const thresholdMatch = raw.match(/Aborting run after\s+(\d+)\s+consecutive download failures\s+\(threshold=(\d+)\)/i);
  if (thresholdMatch?.[1] && thresholdMatch?.[2]) {
    return `Se detuvo la corrida tras ${thresholdMatch[1]} fallas consecutivas de descarga (umbral=${thresholdMatch[2]}).`;
  }

  if (raw === "http_429") {
    return "Demasiadas solicitudes (HTTP 429).";
  }

  const httpCodeMatch = raw.match(/^http_(\d{3})$/i);
  if (httpCodeMatch?.[1]) {
    return `Error HTTP ${httpCodeMatch[1]}.`;
  }

  return raw;
}
