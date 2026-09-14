/**
 * Login screen parity and the passphrase-handling rules (`FE-09`).
 *
 * The markup and the three status strings are transcribed from `TestLoginRendersForm`,
 * `TestLoginErrorStatus`, and `TestLoginButtonText` in `web/components/login_test.go`, so this
 * file is a parity fixture for the Go screen rather than a restatement of `login.tsx`.
 *
 * On top of that, three assertions exist for the requirement that the passphrase is never
 * rendered, logged, or stored: after an attempt the secret must not be in the DOM, must not have
 * reached `console`, and must not be in either web storage. They are cheap and they guard the one
 * property of this screen that would be a real incident rather than a bug.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { delay } from "msw";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { routes } from "../routes";
import { HttpResponse, errorResponse, http, installMockApi } from "../test/msw";

const server = installMockApi();

/** Not a real secret: the passphrase this suite types into the field. */
const PASSPHRASE = "correct horse battery staple";

/** Rails' answer to a good passphrase: 204, no body. */
function sessionCreated(received: { body?: string } = {}) {
  return http.post("/api/session", async ({ request }) => {
    received.body = await request.text();
    return new HttpResponse(null, { status: 204 });
  });
}

/** Renders the real route table at /login, so the route wiring is under test too. */
function renderLogin() {
  const router = createMemoryRouter(routes, { initialEntries: ["/login"] });
  const view = render(<RouterProvider router={router} />);
  return { ...view, router };
}

function submitPassphrase(value: string) {
  fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

function passphraseField(): HTMLInputElement {
  return screen.getByLabelText("Passphrase");
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("login screen", () => {
  it("renders login.go's form", () => {
    const { container } = renderLogin();

    expect(container.querySelector(".login-screen")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Waunder" })).toBeInTheDocument();
    expect(container.querySelector("form.login-form")).not.toBeNull();
    const field = passphraseField();
    expect(field).toHaveClass("login-passphrase");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("placeholder", "Passphrase");
    const button = screen.getByRole("button", { name: "Sign in" });
    expect(button).toHaveClass("login-submit");
    expect(button).toBeEnabled();
    // No status paragraph until something has been attempted.
    expect(container.querySelector(".login-status")).toBeNull();
  });

  it("posts the passphrase form-encoded and lands on the ingestion landing", async () => {
    const received: { body?: string } = {};
    server.use(sessionCreated(received));
    const { router } = renderLogin();

    submitPassphrase(PASSPHRASE);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    // Exactly what Go's url.Values{"passphrase"} encoded.
    expect(received.body).toBe("passphrase=correct+horse+battery+staple");
    // replace, so Back does not return to the login screen with a live session.
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("shows Incorrect passphrase. on a 401 and stays on the login screen", async () => {
    server.use(errorResponse("post", "/api/session", 401, "unauthorized", "Unauthorized"));
    const { router } = renderLogin();

    submitPassphrase("wrong");

    await waitFor(() => {
      expect(screen.getByText("Incorrect passphrase.")).toHaveClass("login-status");
    });
    expect(router.state.location.pathname).toBe("/login");
  });

  it("shows the transient message on any other failure", async () => {
    server.use(errorResponse("post", "/api/session", 500, "server_error", "boom"));
    renderLogin();

    submitPassphrase(PASSPHRASE);

    await waitFor(() => {
      expect(screen.getByText("Could not sign in. Please try again.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Incorrect passphrase.")).toBeNull();
  });

  it("asks for a passphrase without sending an empty one", async () => {
    let calls = 0;
    server.use(
      http.post("/api/session", () => {
        calls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderLogin();

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter your passphrase.")).toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it("disables the button and says Signing in… while the request is in flight", async () => {
    server.use(
      http.post("/api/session", async () => {
        await delay(30);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderLogin();

    submitPassphrase(PASSPHRASE);

    const button = await screen.findByRole("button", { name: "Signing in…" });
    expect(button).toBeDisabled();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Signing in…" })).toBeNull();
    });
  });

  it("never renders, logs, or stores the passphrase", async () => {
    const logged: unknown[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      });
    }
    server.use(errorResponse("post", "/api/session", 401, "unauthorized", "Unauthorized"));
    const { container } = renderLogin();

    submitPassphrase(PASSPHRASE);
    await waitFor(() => {
      expect(screen.getByText("Incorrect passphrase.")).toBeInTheDocument();
    });

    // Cleared from the field on failure, exactly as login.go cleared its own state.
    expect(passphraseField().value).toBe("");
    // Uncontrolled input: React emits no value attribute, so the secret is in no markup.
    expect(container.innerHTML).not.toContain(PASSPHRASE);
    expect(document.body.innerHTML).not.toContain(PASSPHRASE);
    expect(JSON.stringify(logged)).not.toContain(PASSPHRASE);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("clears the field after a successful sign-in too", async () => {
    server.use(sessionCreated());
    const { router } = renderLogin();
    const field = passphraseField();

    submitPassphrase(PASSPHRASE);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(field.value).toBe("");
  });
});
