import { BotJob } from "../botQueue";
import { parseLooseBotJobs } from "./config";

export function parseBotJobs(value: string | undefined, defaults?: BotJob[]): BotJob[] {
  if (!value) {
    return defaults ?? [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    parsed = parseLooseBotJobs(value);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("--bot-jobs must be a JSON array");
  }
  return parsed.map((item, index) => {
    if (typeof item !== "object" || !item) {
      throw new Error(`Invalid bot job at index ${index}`);
    }
    const job = item as {
      id?: unknown;
      bot?: unknown;
      searchTerm?: unknown;
      maxPages?: unknown;
      maxRecords?: unknown;
    };
    if (typeof job.bot !== "string" || typeof job.searchTerm !== "string") {
      throw new Error(`Bot job at index ${index} requires string bot and searchTerm`);
    }
    return {
      id: typeof job.id === "string" ? job.id : `job-${index + 1}`,
      bot: job.bot,
      searchTerm: job.searchTerm,
      maxPages: typeof job.maxPages === "number" ? job.maxPages : undefined,
      maxRecords: typeof job.maxRecords === "number" ? job.maxRecords : undefined,
    };
  });
}
