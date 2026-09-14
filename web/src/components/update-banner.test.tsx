import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pwaManifest } from "../../vite.config";

const workbox = vi.hoisted(() => ({
  needRefresh: false,
  updateServiceWorker: vi.fn<() => Promise<void>>(),
}));

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    needRefresh: [workbox.needRefresh, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: workbox.updateServiceWorker,
  }),
}));

import { UpdateBanner } from "./update-banner";

beforeEach(() => {
  workbox.needRefresh = false;
  workbox.updateServiceWorker.mockReset();
  workbox.updateServiceWorker.mockResolvedValue();
});

describe("PWA manifest", () => {
  it("preserves the installed Go PWA identity without introducing an id", () => {
    expect(pwaManifest).toMatchObject({
      name: "Waunder",
      short_name: "Waunder",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#2d2c2c",
      theme_color: "#2d2c2c",
    });
    expect(pwaManifest).not.toHaveProperty("id");
    expect(pwaManifest.icons).toEqual([
      { src: "/icon.svg", type: "image/png", purpose: "maskable", sizes: "512x512" },
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icon.svg", type: "image/png", sizes: "512x512" },
      { src: "/icon.svg", type: "image/png", sizes: "192x192" },
    ]);
  });
});

describe("UpdateBanner", () => {
  it("stays hidden until Workbox signals that an update is ready", () => {
    render(<UpdateBanner />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders on Workbox's update signal and activates the new build on request", () => {
    workbox.needRefresh = true;
    render(<UpdateBanner />);

    expect(screen.getByRole("status")).toHaveTextContent("A new version of Waunder is ready.");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(workbox.updateServiceWorker).toHaveBeenCalledOnce();
  });
});
