import { describe, expect, it } from "vitest";
import { HeaderSelector } from "../src/network/headerSelector";

describe("header selector", () => {
  it("uses stable profile for per-run strategy", () => {
    const selectorA = new HeaderSelector({
      enabled: true,
      strategy: "per-run",
      sessionKey: "civil:abc123",
    });
    const selectorB = new HeaderSelector({
      enabled: true,
      strategy: "per-run",
      sessionKey: "civil:abc123",
    });

    expect(selectorA.select("portal-document")["User-Agent"]).toBe(selectorB.select("portal-document")["User-Agent"]);
  });

  it("rotates on each request for per-request strategy", () => {
    const selector = new HeaderSelector({
      enabled: true,
      strategy: "per-request",
      sessionKey: "civil:abc123",
    });

    const ua1 = selector.select("portal-document")["User-Agent"];
    const ua2 = selector.select("portal-document")["User-Agent"];
    const ua3 = selector.select("portal-document")["User-Agent"];

    expect(new Set([ua1, ua2, ua3]).size).toBeGreaterThan(1);
  });

  it("honors forced profile id", () => {
    const selector = new HeaderSelector({
      enabled: true,
      strategy: "per-request",
      forcedProfileId: "firefox-win",
      sessionKey: "civil:abc123",
    });

    const first = selector.select("portal-document");
    const second = selector.select("pdf-download");
    expect(first["User-Agent"]).toContain("Firefox");
    expect(second["User-Agent"]).toContain("Firefox");
  });
});
