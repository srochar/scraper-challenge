export type HeaderRotationStrategy = "off" | "per-run" | "per-request";

export type HeaderRequestKind = "portal-document" | "portal-ajax" | "portal-download" | "pdf-download";

export interface HeaderProfile {
  id: string;
  userAgent: string;
  acceptLanguage: string;
}

export interface HeaderSelectorOptions {
  enabled: boolean;
  strategy: HeaderRotationStrategy;
  forcedProfileId?: string;
  sessionKey: string;
}

const PROFILES: HeaderProfile[] = [
  {
    id: "chrome-win",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    acceptLanguage: "es-US,es-419;q=0.9,es;q=0.8,en-US;q=0.7,en;q=0.6",
  },
  {
    id: "edge-win",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0",
    acceptLanguage: "es-PE,es-419;q=0.9,es;q=0.8,en-US;q=0.7,en;q=0.6",
  },
  {
    id: "firefox-win",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0",
    acceptLanguage: "es-ES,es;q=0.9,en-US;q=0.7,en;q=0.6",
  },
];

export class HeaderSelector {
  private readonly enabled: boolean;

  private readonly strategy: HeaderRotationStrategy;

  private readonly forcedProfileId?: string;

  private readonly sessionKey: string;

  private roundRobinCursor = 0;

  constructor(options: HeaderSelectorOptions) {
    this.enabled = options.enabled;
    this.strategy = options.strategy;
    this.forcedProfileId = options.forcedProfileId?.trim() || undefined;
    this.sessionKey = options.sessionKey;
  }

  describe(): { enabled: boolean; strategy: HeaderRotationStrategy; forcedProfileId?: string; profiles: string[] } {
    return {
      enabled: this.enabled,
      strategy: this.strategy,
      forcedProfileId: this.forcedProfileId,
      profiles: PROFILES.map((profile) => profile.id),
    };
  }

  select(kind: HeaderRequestKind): Record<string, string> {
    const profile = this.pickProfile();
    return {
      "User-Agent": profile.userAgent,
      "Accept-Language": profile.acceptLanguage,
      "Accept-Encoding": "gzip, deflate, br",
      Accept: acceptFor(kind),
      "Cache-Control": "max-age=0",
    };
  }

  private pickProfile(): HeaderProfile {
    const forced = this.findById(this.forcedProfileId);
    if (forced) {
      return forced;
    }

    if (!this.enabled || this.strategy === "off") {
      return PROFILES[0];
    }

    if (this.strategy === "per-run") {
      return PROFILES[stableIndex(this.sessionKey, PROFILES.length)];
    }

    const profile = PROFILES[this.roundRobinCursor % PROFILES.length];
    this.roundRobinCursor += 1;
    return profile;
  }

  private findById(id: string | undefined): HeaderProfile | undefined {
    if (!id) {
      return undefined;
    }
    const normalized = id.toLowerCase();
    return PROFILES.find((profile) => profile.id.toLowerCase() === normalized);
  }
}

function acceptFor(kind: HeaderRequestKind): string {
  if (kind === "portal-ajax") {
    return "application/xml, text/xml, */*; q=0.01";
  }
  if (kind === "pdf-download") {
    return "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8";
  }
  return "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
}

function stableIndex(input: string, size: number): number {
  let hash = 0;
  for (let idx = 0; idx < input.length; idx += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(idx);
    hash |= 0;
  }
  const positive = hash >>> 0;
  return positive % size;
}

export function isHeaderRotationStrategy(value: string): value is HeaderRotationStrategy {
  return value === "off" || value === "per-run" || value === "per-request";
}
