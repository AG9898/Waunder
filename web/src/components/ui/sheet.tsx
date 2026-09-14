// Vendored shadcn/ui-style Sheet (UI-02): an edge-anchored Dialog.
import { Dialog, type DialogProps } from "./dialog";

const sides = {
  bottom: "mt-auto mb-0 w-full max-w-none rounded-b-none",
  right: "mr-0 ml-auto h-full max-h-none rounded-r-none",
} as const;

export function Sheet({
  side = "bottom",
  className,
  ...props
}: Omit<DialogProps, "slot"> & { side?: keyof typeof sides }) {
  return (
    <Dialog
      slot="sheet"
      className={[sides[side], className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
