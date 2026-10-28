import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("explains a lost connection without exposing the browser error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  await expect(api.getGame("test")).rejects.toThrow("No hi ha connexió amb la taula");
});

it("rejects malformed responses instead of treating them as a game", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
  await expect(api.getGame("test")).rejects.toThrow("El servidor no ha pogut respondre correctament");
});

it("preserves the authoritative state after a version conflict", async () => {
  const current = { id: "test", version: 2 };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "La partida ha canviat", current }), { status: 409 })));
  await expect(api.getGame("test")).rejects.toMatchObject({ message: "La partida ha canviat", current });
});
