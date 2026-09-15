import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusChip } from "./status-chip";

const root = join(import.meta.dirname, "..", "..", "..");
const css = readFileSync(join(root, "public", "app.css"), "utf8");

const cases = [
  {
    status: "interested",
    label: "Interested",
    tone: "interested",
    fill: "#ece5da",
    ink: "#5d584f",
    dot: "#8c8579",
    border: "none",
  },
  {
    status: "drafting",
    label: "Drafting",
    tone: "drafting",
    fill: "#eee6ee",
    ink: "#6a4a6a",
    dot: "#8f6690",
    border: "none",
  },
  {
    status: "needs_review",
    label: "Needs review",
    tone: "needs_review",
    fill: "#f5ecd9",
    ink: "#8a601f",
    dot: "#b07d35",
    border: "none",
  },
  {
    status: "applied",
    label: "Applied",
    tone: "applied",
    fill: "#e7ede7",
    ink: "#3a5446",
    dot: "#5e7d6a",
    border: "none",
  },
  {
    status: "interviewing",
    label: "Interviewing",
    tone: "interviewing",
    fill: "#e5ebf1",
    ink: "#3f566f",
    dot: "#5b7896",
    border: "none",
  },
  {
    status: "offer",
    label: "Offer",
    tone: "offer",
    fill: "#d7e5d9",
    ink: "#2f4a38",
    dot: "#4c6a58",
    border: "none",
  },
  {
    status: "rejected",
    label: "Rejected",
    tone: "rejected",
    fill: "#f4e3dc",
    ink: "#843d2c",
    dot: "#a8533f",
    border: "none",
  },
  {
    status: "withdrawn",
    label: "Withdrawn",
    tone: "withdrawn",
    fill: "transparent",
    ink: "#8c8579",
    dot: "#b3aa9c",
    border: "1px solid #d4c9b6",
  },
  {
    status: "archived",
    label: "Archived",
    tone: "archived",
    fill: "transparent",
    ink: "#8c8579",
    dot: "#b3aa9c",
    border: "1px solid #d4c9b6",
  },
  {
    status: "not_applied",
    label: "Not applied",
    tone: "interested",
    fill: "#ece5da",
    ink: "#5d584f",
    dot: "#8c8579",
    border: "none",
  },
] as const;

function declarationsFor(selector: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((value) => value.trim());
    if (!selectors.includes(selector)) continue;
    for (const declaration of (match[2] ?? "").split(";")) {
      const separator = declaration.indexOf(":");
      if (separator < 0) continue;
      const property = declaration.slice(0, separator).trim();
      const value = declaration.slice(separator + 1).trim();
      if (property !== "") declarations[property] = value;
    }
  }
  return declarations;
}

describe("StatusChip", () => {
  it.each(cases)("renders $status with its documented tone", (definition) => {
    const { container } = render(<StatusChip status={definition.status} />);
    const chip = container.querySelector<HTMLElement>('[data-slot="status-chip"]');
    const dot = chip?.querySelector<HTMLElement>(".status-chip-dot");

    expect(chip).toHaveClass(
      "status-chip",
      `status-chip--${definition.tone}`,
      "status-chip--desktop",
    );
    expect(chip).toHaveTextContent(definition.label);
    expect(dot).toHaveAttribute("aria-hidden", "true");

    const chipStyles = {
      ...declarationsFor(".status-chip"),
      ...declarationsFor(`.status-chip--${definition.tone}`),
    };
    const dotStyles = declarationsFor(`.status-chip--${definition.tone} .status-chip-dot`);
    expect(chipStyles.background).toBe(definition.fill);
    expect(chipStyles.color).toBe(definition.ink);
    expect(chipStyles.border).toBe(definition.border);
    expect(dotStyles.background).toBe(definition.dot);
  });

  it("uses the 24px touch size without changing the tone", () => {
    const { container } = render(<StatusChip status="applied" size="touch" />);
    const chip = container.querySelector<HTMLElement>('[data-slot="status-chip"]');

    expect(chip).toHaveClass("status-chip--applied", "status-chip--touch");
    expect(declarationsFor(".status-chip--touch").height).toBe("24px");
    expect(declarationsFor(".status-chip--desktop").height).toBe("22px");
  });

  it("falls back to the Interested tone for an unknown status", () => {
    const { container } = render(<StatusChip status="future_status" />);
    const chip = container.querySelector<HTMLElement>('[data-slot="status-chip"]');

    expect(chip).toHaveClass("status-chip--interested");
    expect(chip).toHaveTextContent("Interested");
  });
});
