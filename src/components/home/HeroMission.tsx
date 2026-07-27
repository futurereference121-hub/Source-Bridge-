export function HeroMission() {
  return (
    <div className="relative z-10 mx-auto w-full max-w-3xl text-center">
      <h1 className="animate-fade-up text-[1.85rem] font-bold leading-[1.12] tracking-[-0.025em] text-white sm:text-4xl md:text-[2.75rem] lg:text-[3.35rem] lg:leading-[1.1]">
        <span className="block">If you&apos;re somewhere,</span>
        <span className="block">or you&apos;re going somewhere,</span>
        <span className="mt-0.5 block text-electric">you can help someone.</span>
      </h1>

      <p className="animate-fade-up animate-delay-1 mx-auto mt-6 max-w-lg text-[15px] font-medium leading-snug tracking-[-0.01em] text-white/75 sm:text-base md:text-[17px]">
        Unlocking the value of human location.
      </p>

      <div
        className="animate-fade-up animate-delay-1 mx-auto mt-7 h-px w-16 bg-electric/55 sm:mt-8"
        aria-hidden="true"
      />

      <p className="animate-fade-up animate-delay-1 mx-auto mt-6 max-w-md text-[13px] font-medium tracking-[0.04em] text-white/65 sm:text-sm">
        People are the bridge. Location is the value.
      </p>
    </div>
  );
}
