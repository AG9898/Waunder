import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "../../lib/cn";

export function Drawer({
  shouldScaleBackground = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return (
    <DrawerPrimitive.Root
      data-slot="drawer"
      shouldScaleBackground={shouldScaleBackground}
      {...props}
    />
  );
}

export function DrawerTrigger({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

export function DrawerPortal({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

export function DrawerClose({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

export const DrawerOverlay = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(function DrawerOverlay({ className, ...props }, ref) {
  return (
    <DrawerPrimitive.Overlay
      ref={ref}
      data-slot="drawer-overlay"
      className={cn("fixed inset-0 z-40 bg-ink/30", className)}
      {...props}
    />
  );
});

export const DrawerHandle = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Handle>
>(function DrawerHandle({ className, ...props }, ref) {
  return (
    <DrawerPrimitive.Handle
      ref={ref}
      data-slot="drawer-handle"
      aria-hidden="true"
      className={cn("mx-auto mt-4 h-1 w-9 shrink-0 rounded-pill bg-border-strong", className)}
      {...props}
    />
  );
});

export const DrawerContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(function DrawerContent({ className, children, ...props }, ref) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        ref={ref}
        data-slot="drawer-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex h-auto max-h-[80vh] flex-col rounded-t-[18px] border border-border bg-surface pb-[env(safe-area-inset-bottom)] font-sans text-ink shadow-md outline-none focus-visible:ring-2 focus-visible:ring-accent",
          className,
        )}
        {...props}
      >
        <DrawerHandle />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
});

export function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex flex-col gap-1 p-4 text-center", className)}
      {...props}
    />
  );
}

export function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

export const DrawerTitle = React.forwardRef<
  HTMLHeadingElement,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(function DrawerTitle({ className, ...props }, ref) {
  return (
    <DrawerPrimitive.Title
      ref={ref}
      data-slot="drawer-title"
      className={cn("text-lg font-semibold text-ink", className)}
      {...props}
    />
  );
});

export const DrawerDescription = React.forwardRef<
  HTMLParagraphElement,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(function DrawerDescription({ className, ...props }, ref) {
  return (
    <DrawerPrimitive.Description
      ref={ref}
      data-slot="drawer-description"
      className={cn("text-sm text-ink-soft", className)}
      {...props}
    />
  );
});
