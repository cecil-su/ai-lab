import { describe, expect, it, vi } from "vitest";
import { classifyServerUrl, MemoryProfileStore, toPersistedProfile } from "./profileStore";

describe("profile persistence boundaries", () => {
  it("persists profile metadata without the token", () => {
    const profile = toPersistedProfile(
      {
        name: "Team server",
        serverUrl: "http://10.0.0.5:4180/",
        channelId: "chan-1",
        token: "secret-token",
      },
      1000,
    );

    expect(profile).toEqual({
      id: expect.any(String),
      name: "Team server",
      serverUrl: "http://10.0.0.5:4180",
      channelId: "chan-1",
      createdAt: 1000,
      updatedAt: 1000,
    });
    expect(JSON.stringify(profile)).not.toContain("secret-token");
  });

  it("stores token separately from listed profiles", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2000);
    const store = new MemoryProfileStore();
    const profile = await store.saveProfile({
      name: "Local",
      serverUrl: "https://agentparty.example",
      channelId: "chan-2",
      token: "secret-token",
    });

    await expect(store.getToken(profile.id)).resolves.toBe("secret-token");
    await expect(store.listProfiles()).resolves.toEqual([
      expect.not.objectContaining({ token: "secret-token" }),
    ]);
  });

  it("distinguishes HTTP intranet and HTTPS connections", () => {
    expect(classifyServerUrl("http://172.19.10.185:4180")).toBe("trusted-intranet-http");
    expect(classifyServerUrl("https://agentparty.example")).toBe("https");
  });
});
