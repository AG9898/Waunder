import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";
import { Dialog } from "./dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Select } from "./select";
import { Sheet } from "./sheet";

const root = join(import.meta.dirname, "..", "..", "..");
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

class TestResizeObserver {
  observe(): void {
    void 0;
  }

  unobserve(): void {
    void 0;
  }

  disconnect(): void {
    void 0;
  }
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  vi.unstubAllGlobals();
});

describe("vendored UI primitives", () => {
  it("pins the runtime UI dependency list", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(
      // UI-06 adds lucide-react; UI-07 adds the pinned shadcn command/Radix runtime dependencies.
      [
        "@tanstack/react-query",
        "@tanstack/react-table",
        "@tanstack/react-virtual",
        "cmdk",
        "lucide-react",
        "radix-ui",
        "react",
        "react-dom",
        "react-router",
        "zod",
      ].sort(),
    );
    expect(pkg.dependencies["lucide-react"]).toBe("1.46.0");
    expect(pkg.dependencies.cmdk).toBe("1.1.1");
    expect(pkg.dependencies["radix-ui"]).toBe("1.6.7");
  });

  it("keeps generated primitives on Waunder token utilities", () => {
    const source = ["popover.tsx", "command.tsx", "dropdown-menu.tsx"]
      .map((file) => readFileSync(join(root, "src", "components", "ui", file), "utf8"))
      .join("\n");
    expect(source).toContain("rounded-panel");
    expect(source).toContain("bg-surface");
    expect(source).toContain("border-border");
    expect(source).toContain("shadow-md");
    expect(source).toContain("focus-visible:ring-accent");
    for (const forbidden of ["bg-popover", "text-popover-foreground", "text-muted-foreground", "bg-black"]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toMatch(/\b(?:bg|text|border|shadow|ring)-\[[^\]]+\]/);
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

  it("opens Popover, closes on Escape, and returns focus to its trigger", async () => {
    render(
      <Popover>
        <PopoverTrigger asChild>
          <button type="button">Open popover</button>
        </PopoverTrigger>
        <PopoverContent>
          <p>Popover content</p>
        </PopoverContent>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Open popover" });
    fireEvent.click(trigger);
    const content = await screen.findByText("Popover content");
    expect(content.parentElement).toHaveClass(
      "rounded-panel",
      "bg-surface",
      "border-border",
      "shadow-md",
    );

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByText("Popover content")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it("opens DropdownMenu, moves with ArrowDown, closes on Escape, and returns focus", async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Open menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>First item</DropdownMenuItem>
          <DropdownMenuItem>Second item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const trigger = screen.getByRole("button", { name: "Open menu" });
    fireEvent.pointerDown(trigger);
    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass("rounded-panel", "bg-surface", "border-border", "shadow-md");
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(2);

    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(items[1]));

    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it("opens CommandDialog, navigates command items, closes on Escape, and returns focus", async () => {
    function CommandHarness() {
      return (
        <CommandDialog trigger={<button type="button">Open command</button>}>
          <CommandInput placeholder="Search statuses" />
          <CommandList>
            <CommandGroup heading="Statuses">
              <CommandItem value="interested">Interested</CommandItem>
              <CommandItem value="applied">Applied</CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      );
    }

    render(<CommandHarness />);
    const trigger = screen.getByRole("button", { name: "Open command" });
    trigger.focus();
    fireEvent.click(trigger);
    const input = await screen.findByPlaceholderText("Search statuses");
    expect(screen.getByRole("dialog")).toHaveClass(
      "rounded-panel",
      "bg-surface",
      "border-border",
      "shadow-md",
    );
    const interested = screen.getByRole("option", { name: "Interested" });
    const applied = screen.getByRole("option", { name: "Applied" });
    expect(interested).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() => expect(applied).toHaveAttribute("aria-selected", "true"));

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });
});
