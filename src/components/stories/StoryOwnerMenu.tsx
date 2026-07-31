"use client";

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
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-label="Story options"
        className="w-full max-w-sm rounded-xl border border-white/15 bg-[#071428] p-2 text-white shadow-2xl"
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
            className="block w-full rounded-lg px-4 py-3.5 text-left text-sm text-white/90 hover:bg-white/[0.06]"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
