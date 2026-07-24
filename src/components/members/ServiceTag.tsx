type ServiceTagProps = {
  label: string;
};

export function ServiceTag({ label }: ServiceTagProps) {
  return (
    <span className="inline-flex border border-border bg-background px-2.5 py-1 text-[11px] tracking-wide text-ink">
      {label}
    </span>
  );
}
