import { toSpanishErrorMessage } from "../utils/errorMessages";

export interface FatalErrorPayload {
  type: "fatal";
  stage: "main";
  operation: string;
  errorName: string;
  errorMessage: string;
  runId?: string;
  bot?: string;
}

export function toFatalErrorPayload(
  error: unknown,
  operation: string,
  context?: { runId?: string; bot?: string },
): FatalErrorPayload {
  return {
    type: "fatal",
    stage: "main",
    operation,
    errorName: error instanceof Error ? error.name : "Error",
    errorMessage: toSpanishErrorMessage(error),
    runId: context?.runId,
    bot: context?.bot,
  };
}
