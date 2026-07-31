"use client";

import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onView: () => void;
  onAdd: () => void;
  onManage: () => void;
};

export function StoryOwnerMenu({
  open,
  onClose,
  onView,
  onAdd,
  onManage,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    queueMicrotask(() => {
      panelRef.current?.querySelector<HTMLElement>("button")?.focus();
    });
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Story options"
        className="w-full max-w-sm rounded-xl border border-white/15 bg-[#071428] p-2 text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {[
          { label: "View Story", action: onView },
          { label: "Add to Story", action: onAdd },
          { label: "Manage Story", action: onManage },
          { label: "Cancel", action: onClose },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.action}
            className="block min-h-12 w-full rounded-lg px-4 py-3.5 text-left text-sm text-white/90 hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-electric"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
