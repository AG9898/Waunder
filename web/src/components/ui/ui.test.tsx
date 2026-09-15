import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { Dialog } from "./dialog";
import { Input } from "./input";
import { Select } from "./select";
import { Sheet } from "./sheet";

const root = join(import.meta.dirname, "..", "..", "..");

describe("vendored UI primitives", () => {
  it("pins the runtime UI dependency list", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(
      // UI-06 adds lucide-react for the shared source markers; later UI tasks extend this list.
      [
        "@tanstack/react-query",
        "@tanstack/react-table",
        "@tanstack/react-virtual",
        "lucide-react",
        "react",
        "react-dom",
        "react-router",
        "zod",
      ].sort(),
    );
    expect(pkg.dependencies["lucide-react"]).toBe("1.46.0");
  });

  it("opts the ui directory into Tailwind utilities", () => {
    expect(readFileSync(join(root, "src", "styles", "tailwind.css"), "utf8")).toContain(
      '@source "../components/ui";',
    );
  });

  it("renders button, input, and select with token utilities", () => {
    const onClick = vi.fn();
    render(
      <>
        <Button onClick={onClick}>Save</Button>
        <Button variant="secondary">Cancel</Button>
        <Input aria-label="Title" defaultValue="x" />
        <Select aria-label="Band" defaultValue="">
          <option value="">All</option>
          <option value="high">High</option>
        </Select>
      </>,
    );
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toHaveAttribute("type", "button");
    expect(save).toHaveClass("bg-accent", "rounded-md");
    fireEvent.click(save);
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("bg-surface");
    expect(screen.getByLabelText("Title")).toHaveClass("border-border");
    expect(screen.getByLabelText("Band")).toHaveClass("bg-surface");
    expect(screen.getByRole("option", { name: "All" })).toHaveAttribute("value", "");
  });

  it("opens and closes dialog and sheet from props", () => {
    const { container, rerender } = render(
      <>
        <Dialog open onClose={() => {}} title="Confirm">
          <p>Body</p>
        </Dialog>
        <Sheet open={false} onClose={() => {}} title="Filters" />
      </>,
    );
    const dialog = container.querySelector('[data-slot="dialog"]') as HTMLDialogElement;
    const sheet = container.querySelector('[data-slot="sheet"]') as HTMLDialogElement;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(sheet.hasAttribute("open")).toBe(false);
    expect(sheet).toHaveClass("rounded-b-none", "bg-surface");
    rerender(
      <>
        <Dialog open={false} onClose={() => {}} title="Confirm" />
        <Sheet open onClose={() => {}} title="Filters" />
      </>,
    );
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(sheet.hasAttribute("open")).toBe(true);
  });

  it("routes Escape (cancel) to onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<Dialog open onClose={onClose} title="Confirm" />);
    fireEvent(container.querySelector("dialog")!, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
