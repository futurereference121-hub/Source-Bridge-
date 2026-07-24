import { siteConfig } from "@/lib/site";

export function EmailContactStrip() {
  return (
    <div className="relative z-20 w-full bg-white">
      <a
        href={`mailto:${siteConfig.email}`}
        className="mx-auto flex min-h-[64px] max-w-7xl flex-col items-center justify-center px-5 py-3.5 transition-opacity hover:opacity-80 sm:min-h-[72px]"
      >
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3.5 6.75A1.75 1.75 0 0 1 5.25 5h13.5A1.75 1.75 0 0 1 20.5 6.75v10.5A1.75 1.75 0 0 1 18.75 19H5.25A1.75 1.75 0 0 1 3.5 17.25V6.75Z"
                stroke="white"
                strokeWidth="1.6"
              />
              <path
                d="m4.2 7.2 7.2 5.1c.35.25.85.25 1.2 0l7.2-5.1"
                stroke="white"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="flex flex-col items-start gap-1">
            <span className="text-sm font-medium tracking-wide text-navy sm:text-base">
              {siteConfig.email}
            </span>
            <span className="text-[11px] leading-none text-[#9aa3b2] sm:text-xs">
              This is the only way to contact us.
            </span>
          </span>
        </span>
      </a>
    </div>
  );
}
