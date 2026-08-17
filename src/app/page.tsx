import type { Metadata } from "next";
import { Suspense } from "react";
import { HeroMission } from "@/components/home/HeroMission";
import { HeroActions } from "@/components/home/HeroActions";
import { HomeAuthRedirect } from "@/components/home/HomeAuthRedirect";
import { GlobalConnectionVisual } from "@/components/home/GlobalConnectionVisual";
import { EmailContactStrip } from "@/components/home/EmailContactStrip";
import { DeletedAccountNotice } from "@/components/home/DeletedAccountNotice";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Home",
  description: siteConfig.description,
};

export default function HomePage() {
  return (
    <div className="relative flex min-h-[100svh] flex-col bg-hero-navy">
      <Suspense fallback={null}>
        <HomeAuthRedirect />
      </Suspense>
      <DeletedAccountNotice />
      <section className="relative isolate flex min-h-[100svh] flex-1 flex-col overflow-hidden">
        <GlobalConnectionVisual />

        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-5 pb-20 pt-28 text-center sm:px-8 sm:pb-24 lg:px-10 lg:pt-24">
          <HeroMission />
          <HeroActions />
        </div>
      </section>

      <EmailContactStrip />
    </div>
  );
}
