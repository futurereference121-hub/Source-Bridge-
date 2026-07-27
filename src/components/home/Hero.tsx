import Image from "next/image";
import { Button } from "@/components/ui/Button";
import { siteConfig } from "@/lib/site";

type HeroProps = {
  headline?: string;
  subhead?: string;
  imageSrc?: string;
  imageAlt?: string;
};

export function Hero({
  headline = "If you're somewhere, or you're going somewhere, you can help someone.",
  subhead = "Source Bridge connects people around the world through trusted local access, personal sourcing and discoveries shared by members of the community.",
  imageSrc = "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1800&q=80",
  imageAlt = "Travellers and locals connecting across cities and landscapes",
}: HeroProps) {
  return (
    <section className="relative min-h-[100svh] w-full overflow-hidden bg-ink">
      <Image
        src={imageSrc}
        alt={imageAlt}
        fill
        priority
        sizes="100vw"
        className="object-cover object-center animate-fade-in"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-ink/80 via-ink/50 to-ink/25" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_70%,transparent_0%,rgba(18,21,26,0.35)_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-7xl flex-col justify-end px-5 pb-16 pt-28 sm:px-8 sm:pb-20 lg:px-10 lg:pb-24">
        <p className="animate-fade-up font-display text-2xl tracking-[0.12em] text-white sm:text-3xl md:text-4xl">
          {siteConfig.name.toUpperCase()}
        </p>
        <h1 className="animate-fade-up animate-delay-1 mt-6 max-w-4xl font-display text-3xl leading-[1.12] text-white sm:text-5xl md:text-6xl lg:text-[4.25rem]">
          {headline}
        </h1>
        <p className="animate-fade-up animate-delay-2 mt-6 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">
          {subhead}
        </p>
        <div className="animate-fade-up animate-delay-3 mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button href="/explore" variant="primary" size="lg" className="bg-white text-ink hover:bg-stone">
            Explore
          </Button>
          <Button
            href="/sourcing"
            variant="outline"
            size="lg"
            className="border-white/40 text-white hover:border-white hover:bg-white/10"
          >
            Request Product Sourcing
          </Button>
        </div>
      </div>
    </section>
  );
}
