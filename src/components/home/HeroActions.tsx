import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { SecondaryButton } from "@/components/ui/SecondaryButton";

export function HeroActions() {
  return (
    <div className="animate-fade-up animate-delay-2 relative z-10 mt-9 flex flex-col gap-3 sm:flex-row sm:items-stretch">
      <PrimaryButton href="/explore" className="min-h-[52px] px-7 text-[13px]">
        Enter Market
      </PrimaryButton>
      <SecondaryButton
        href="/join?intent=provider"
        className="min-h-[52px] px-6"
      >
        <span className="flex flex-col items-start">
          <span className="text-sm font-bold uppercase tracking-[0.08em]">
            Start Earning
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-80">
            From Your Location
          </span>
        </span>
      </SecondaryButton>
    </div>
  );
}
