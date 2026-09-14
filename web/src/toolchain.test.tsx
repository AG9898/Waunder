import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("client toolchain", () => {
  it("renders a React element into jsdom with jest-dom matchers available", () => {
    render(<p>Waunder client scaffold</p>);

    expect(screen.getByText("Waunder client scaffold")).toBeInTheDocument();
  });
});
