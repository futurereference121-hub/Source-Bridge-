import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { SecondaryButton } from "@/components/ui/SecondaryButton";

export function HeroActions() {
  return (
    <div className="animate-fade-up animate-delay-2 relative z-10 mx-auto mt-9 flex w-full max-w-xl flex-col items-stretch justify-center gap-3 sm:mt-10 sm:flex-row sm:items-stretch sm:justify-center">
      <PrimaryButton
        href="/join"
        className="btn-glow-primary min-h-[52px] rounded-lg px-8 text-[13px] tracking-[0.12em]"
        showArrow={false}
      >
        Join Source Bridge
      </PrimaryButton>
      <SecondaryButton
        href="/sign-in"
        className="btn-glow-secondary min-h-[52px] rounded-lg px-6"
      >
        Sign In
      </SecondaryButton>
      <p className="basis-full text-center text-sm leading-relaxed text-white/60 sm:mt-1">
        Your location could be exactly what someone needs.
      </p>
    </div>
  );
}
