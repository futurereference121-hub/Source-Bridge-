import type { Metadata } from "next";
import { HeroMission } from "@/components/home/HeroMission";
import { HeroActions } from "@/components/home/HeroActions";
import { GlobalConnectionVisual } from "@/components/home/GlobalConnectionVisual";
import { EmailContactStrip } from "@/components/home/EmailContactStrip";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Home",
  description: siteConfig.description,
};

export default function HomePage() {
  return (
    <div className="relative flex min-h-[100svh] flex-col bg-hero-navy">
      <section className="relative flex flex-1 flex-col overflow-hidden">
        <GlobalConnectionVisual />

        <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-5 pb-16 pt-28 sm:px-8 sm:pb-20 lg:px-10 lg:pt-24">
          <div className="max-w-xl lg:max-w-[34rem]">
            <HeroMission />
            <HeroActions />
          </div>
        </div>
      </section>

      <EmailContactStrip />
    </div>
  );
}
