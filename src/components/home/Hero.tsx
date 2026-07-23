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
  headline = "Connecting the World Through Trusted Product Sourcing.",
  subhead = "From Thailand and Russia to retailers worldwide — curated goods, wholesale partnerships, and end-to-end procurement.",
  imageSrc = "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1800&q=80",
  imageAlt = "Premium retail interior with carefully arranged merchandise",
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
      <div className="absolute inset-0 bg-gradient-to-r from-ink/75 via-ink/45 to-ink/25" />

      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-7xl flex-col justify-end px-5 pb-16 pt-28 sm:px-8 sm:pb-20 lg:px-10 lg:pb-24">
        <p className="animate-fade-up text-xs font-medium uppercase tracking-[0.28em] text-white/80">
          {siteConfig.name}
        </p>
        <h1 className="animate-fade-up animate-delay-1 mt-5 max-w-3xl font-display text-4xl leading-[1.08] text-white sm:text-5xl md:text-6xl lg:text-7xl">
          {headline}
        </h1>
        <p className="animate-fade-up animate-delay-2 mt-5 max-w-xl text-base leading-relaxed text-white/80 sm:text-lg">
          {subhead}
        </p>
        <div className="animate-fade-up animate-delay-3 mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button href="/shop" variant="primary" size="lg" className="bg-white text-ink hover:bg-stone">
            Shop Products
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
