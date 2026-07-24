import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { SecondaryButton } from "@/components/ui/SecondaryButton";

export function HeroActions() {
  return (
    <div className="animate-fade-up animate-delay-2 relative z-10 mx-auto mt-9 flex w-full max-w-xl flex-col items-stretch justify-center gap-3 sm:mt-10 sm:flex-row sm:items-stretch">
      <PrimaryButton
        href="/explore"
        className="btn-glow-primary min-h-[52px] rounded-lg bg-[#1d4ed8] px-8 text-[13px] tracking-[0.12em] hover:bg-[#1e40af]"
      >
        Enter Market
      </PrimaryButton>
      <SecondaryButton
        href="/join?intent=provider"
        className="btn-glow-secondary min-h-[52px] rounded-lg px-6"
      >
        <span className="flex flex-col items-start gap-0.5">
          <span className="text-sm font-bold uppercase tracking-[0.08em]">
            Start Earning
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-navy/75">
            From Your Location
          </span>
        </span>
      </SecondaryButton>
    </div>
  );
}
