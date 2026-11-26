"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Drawer } from "vaul";

interface MobileBottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  testId?: string;
}

export function MobileBottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  testId,
}: MobileBottomSheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px]" />
        <Drawer.Content
          data-testid={testId}
          aria-label={title}
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border-default bg-sidebar text-fg-primary shadow-2xl outline-none"
        >
          <div className="mx-auto mt-2.5 h-1.5 w-12 shrink-0 rounded-full bg-border-strong" />
          <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
            <div className="min-w-0">
              <Drawer.Title className="text-sm font-semibold text-fg-primary">
                {title}
              </Drawer.Title>
              {description && (
                <Drawer.Description className="text-xs text-fg-muted">
                  {description}
                </Drawer.Description>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={`Fechar ${title}`}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface text-fg-secondary hover:text-fg-primary"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
