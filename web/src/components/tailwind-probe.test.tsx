import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TailwindProbe } from "./tailwind-probe";

const root = join(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

describe("Tailwind setup", () => {
  it("imports only the theme and utilities layers, never Preflight", () => {
    const css = read("src", "styles", "tailwind.css");
    const imports = [...css.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["tailwindcss/theme", "tailwindcss/utilities"]);
  });

  it("derives @theme from app.css :root tokens without changing a value", () => {
    const tokens = new Map(
      [...read("public", "app.css").matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [
        m[1],
        (m[2] ?? "").replace(/\s+/g, "").replace(/0\./g, "."),
      ]),
    );
    const theme = read("src", "styles", "tailwind.css").split("@theme {")[1] ?? "";
    const defined = [
      ...theme.matchAll(/(--(?:color|text|radius|shadow|font|control-h)-[a-z-]+):\s*([^;]+);/g),
    ];
    expect(defined.length).toBeGreaterThan(30);
    for (const [, name, value] of defined) {
      expect(tokens.get(name!), name).toBe((value ?? "").replace(/\s+/g, "").replace(/0\./g, "."));
    }

    for (const name of [
      "--radius-control",
      "--radius-panel",
      "--color-grid-header",
      "--color-grid-line",
      "--color-row-hover",
      "--color-row-active",
      "--color-header-sorted",
      "--control-h-desktop",
      "--control-h-touch",
    ]) {
      expect(defined.some(([, definedName]) => definedName === name), name).toBe(true);
    }
  });

  it("keeps app.css linked from index.html", () => {
    expect(read("index.html")).toContain('<link rel="stylesheet" href="/app.css" />');
  });

  it("renders the probe with token utilities", () => {
    render(<TailwindProbe />);
    expect(screen.getByTestId("tailwind-probe")).toHaveClass("bg-accent-soft", "rounded-pill");
  });
});
