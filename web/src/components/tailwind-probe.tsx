// Unrouted probe proving Tailwind utilities resolve against the Waunder tokens (UI-01).
// No shipped screen renders it; delete once a real screen adopts utilities.
export function TailwindProbe() {
  return (
    <p
      data-testid="tailwind-probe"
      className="rounded-pill bg-accent-soft px-3 py-1 text-xs text-accent-ink"
    >
      Tailwind probe
    </p>
  );
}
