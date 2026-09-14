import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOAST_DURATION_MS, clearToasts, showToast } from "../../lib/toast";
import { Toaster } from "./toast";

afterEach(() => {
  vi.useRealTimers();
});

describe("Toaster", () => {
  it("announces toasts through a polite live region", () => {
    render(<Toaster />);
    act(() => {
      showToast("Profile saved.");
    });
    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("Profile saved.");
  });

  it("dismisses on click", () => {
    const { container } = render(<Toaster />);
    act(() => {
      showToast("Could not update the job.", "danger");
    });
    expect(container.querySelector('[data-tone="danger"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(container.querySelector(".toast")).toBeNull();
  });

  it("dismisses itself after the duration and does not stack duplicates", () => {
    vi.useFakeTimers();
    const { container } = render(<Toaster />);
    act(() => {
      showToast("Saved.");
      showToast("Saved.");
    });
    expect(container.querySelectorAll(".toast")).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(container.querySelector(".toast")).toBeNull();
    clearToasts();
  });
});
