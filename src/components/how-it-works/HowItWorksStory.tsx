"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import {
  Bell,
  Camera,
  CheckCircle2,
  CircleDot,
  MapPin,
  MessageCircle,
  Package,
  Plane,
  Sparkles,
  Store,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { SecondaryButton } from "@/components/ui/SecondaryButton";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CeramicCup, LocationPin, RouteArc, StickFigure, Suitcase } from "./illustrations";

const ELECTRIC = "#60a5fa";
const SOFT_WHITE = "rgba(255,255,255,0.82)";
const AMBER = "#fbbf24";

/* ---------------------------------- Motion helpers ---------------------------------- */

function Reveal({
  children,
  className = "",
  delay = 0,
  y = 22,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.35 }}
      transition={{ duration: reduce ? 0.01 : 0.65, delay: reduce ? 0 : delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------ Small pieces ----------------------------------- */

function ChapterTag({ number, label }: { number: string; label: string }) {
  return (
    <div className="flex items-center gap-3 text-white/35">
      <span className="font-display text-3xl text-white/25 sm:text-4xl">{number}</span>
      <span className="h-px w-10 bg-white/15 sm:w-14" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.22em]">{label}</span>
    </div>
  );
}

function IllustrationFrame({ children }: { children: ReactNode }) {
  return (
    <div className="panel-navy-soft relative mx-auto flex aspect-[4/3] w-full max-w-md items-center justify-center overflow-hidden rounded-3xl p-6 sm:p-8">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(59,130,246,0.1),transparent_70%)]" />
      <div className="relative h-full w-full">{children}</div>
    </div>
  );
}

function Scene({
  number,
  eyebrow,
  illustrationSide = "right",
  illustration,
  children,
}: {
  number: string;
  eyebrow: string;
  illustrationSide?: "left" | "right";
  illustration: ReactNode;
  children: ReactNode;
}) {
  const textOrder = illustrationSide === "right" ? "lg:order-1" : "lg:order-2";
  const artOrder = illustrationSide === "right" ? "lg:order-2" : "lg:order-1";
  return (
    <section className="py-10 sm:py-14">
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <Reveal className={textOrder}>
            <ChapterTag number={number} label={eyebrow} />
            <div className="mt-5">{children}</div>
          </Reveal>
          <Reveal delay={0.12} className={artOrder}>
            <IllustrationFrame>{illustration}</IllustrationFrame>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

function InfoCard({
  kind,
  label,
  text,
}: {
  kind: "status" | "opportunity";
  label: string;
  text: string;
}) {
  const isOpportunity = kind === "opportunity";
  const Icon = isOpportunity ? Sparkles : CircleDot;
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3.5 ${
        isOpportunity
          ? "border-amber-400/25 bg-gradient-to-br from-amber-400/[0.08] to-transparent"
          : "border-sky-400/20 bg-sky-400/[0.05]"
      }`}
    >
      <span
        className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          isOpportunity ? "bg-amber-400/10 text-amber-300" : "bg-sky-400/10 text-sky-300"
        }`}
      >
        <Icon size={14} strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p
          className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
            isOpportunity ? "text-amber-300/90" : "text-sky-300/80"
          }`}
        >
          {label}
        </p>
        <p className="mt-1 text-sm leading-snug text-white/85">{text}</p>
      </div>
    </div>
  );
}

function ChatBubble({
  from,
  align = "left",
  children,
}: {
  from: string;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const isRight = align === "right";
  return (
    <div className={`flex flex-col ${isRight ? "items-end" : "items-start"}`}>
      <span className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
        {from}
      </span>
      <div
        className={`flex max-w-[280px] items-start gap-2 rounded-2xl border px-4 py-3 text-sm leading-snug ${
          isRight
            ? "rounded-tr-sm border-electric/30 bg-electric/[0.14] text-white/90"
            : "rounded-tl-sm border-white/10 bg-white/[0.05] text-white/85"
        }`}
      >
        <MessageCircle size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-white/35" />
        <span>{children}</span>
      </div>
    </div>
  );
}

function TermPill({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-white/75">
      <Icon size={13} strokeWidth={2} className="text-electric" />
      {text}
    </span>
  );
}

/* ---------------------------------- Scene illustrations ------------------------------- */

function TripIllustration() {
  return (
    <div className="flex h-full w-full flex-col justify-between">
      <div className="flex items-start justify-between px-1">
        <LocationPin label="London" color={SOFT_WHITE} />
        <LocationPin label="Kutaisi" color={AMBER} />
      </div>
      <RouteArc className="mx-1" />
      <div className="flex items-end justify-center gap-3">
        <StickFigure color={ELECTRIC} hair="pony" pose="carry" bob size={68} />
        <Suitcase size={30} />
      </div>
    </div>
  );
}

function SparkIllustration() {
  const reduce = useReducedMotion();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5">
      <div className="relative">
        <span className="hiw-ring-pulse absolute inset-0 -m-2 rounded-full border border-electric/40" />
        <span className="relative flex h-11 w-11 items-center justify-center rounded-full border border-electric/30 bg-electric/10 text-electric">
          <Bell size={18} strokeWidth={2} />
        </span>
      </div>
      <StickFigure color={SOFT_WHITE} hair="short" pose="point" size={68} />
      <motion.div
        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-2"
        initial={reduce ? { opacity: 1 } : { opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: reduce ? 0.01 : 0.6, delay: 0.3 }}
      >
        <CeramicCup size={22} />
        <MessageCircle size={14} strokeWidth={2} className="text-white/40" />
        <span className="text-[11px] font-medium text-white/60">Sourcing request sent</span>
      </motion.div>
    </div>
  );
}

function AgreementIllustration() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4">
      <div className="flex w-full flex-col gap-3">
        <ChatBubble from="Nathan" align="left">
          Could you find a small handmade ceramic cup? Blue glaze, like the market ones.
        </ChatBubble>
        <ChatBubble from="Jill" align="right">
          I can look. Photos before I buy — then you choose.
        </ChatBubble>
      </div>
    </div>
  );
}

function SourcingIllustration() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6">
      <div className="flex items-center gap-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/70">
          <Store size={18} strokeWidth={2} />
        </span>
        <span className="h-px w-8 bg-white/15" />
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/70">
          <Camera size={18} strokeWidth={2} />
        </span>
        <span className="h-px w-8 bg-white/15" />
        <div className="relative">
          <CeramicCup size={36} />
          <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-electric text-white shadow-[0_0_10px_rgba(96,165,250,0.6)]">
            <CheckCircle2 size={12} strokeWidth={2.5} />
          </span>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex flex-col items-center gap-1.5">
          <Suitcase size={26} />
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/45">Carry</span>
        </div>
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/30">or</span>
        <div className="flex flex-col items-center gap-1.5">
          <span className="flex h-[26px] w-[30px] items-center justify-center text-electric">
            <Package size={24} strokeWidth={2} />
          </span>
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/45">Ship</span>
        </div>
      </div>
    </div>
  );
}

function HandoverIllustration() {
  const reduce = useReducedMotion();
  return (
    <div className="flex h-full w-full items-center justify-center gap-5 sm:gap-8">
      <StickFigure color={ELECTRIC} hair="pony" pose="receive" size={64} />
      <motion.div
        className="relative"
        initial={reduce ? { opacity: 1, x: 0 } : { opacity: 0, x: -28 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: reduce ? 0.01 : 0.9, delay: 0.35, ease: "easeInOut" }}
      >
        <span className="hiw-ring-pulse absolute inset-0 -m-2 rounded-full border border-electric/40" />
        <CeramicCup size={32} />
      </motion.div>
      <StickFigure color={SOFT_WHITE} hair="short" pose="receive" flip size={64} />
    </div>
  );
}

/* ------------------------------------- Use cases -------------------------------------- */

type UseCase = {
  title: string;
  body: string;
  cta: string;
  href: string;
  icon: LucideIcon;
};

const USE_CASES: UseCase[] = [
  {
    title: "Travellers",
    body: "Already booking a flight? Post it as an opportunity and turn spare luggage space into value.",
    cta: "Post an Opportunity",
    href: "/join?intent=provider",
    icon: Plane,
  },
  {
    title: "Expats",
    body: "Living somewhere new? Your everyday access is exactly what someone back home can't get.",
    cta: "Explore the Network",
    href: "/explore",
    icon: MapPin,
  },
  {
    title: "Specialists",
    body: "Deep local knowledge or a specific skill? List it once and let requests find you.",
    cta: "Create Your Profile",
    href: "/join",
    icon: Sparkles,
  },
  {
    title: "Buyers",
    body: "Need something specific from somewhere else? Send a sourcing request and let the network respond.",
    cta: "Send a Sourcing Request",
    href: "/explore",
    icon: MessageCircle,
  },
];

function UseCases() {
  return (
    <section className="border-t border-white/10 py-20 sm:py-28">
      <Container>
        <Reveal>
          <SectionHeading
            eyebrow="Who it's for"
            title="Built for people already in motion."
            description="Four ways members create and find value on Source Bridge."
            tone="on-dark"
          />
        </Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {USE_CASES.map((item, i) => (
            <Reveal key={item.title} delay={i * 0.08}>
              <div className="card-navy flex h-full flex-col rounded-2xl p-6">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-electric/10 text-electric">
                  <item.icon size={18} strokeWidth={2} />
                </span>
                <h3 className="mt-4 font-display text-xl text-white">{item.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-white/60">{item.body}</p>
                <Link
                  href={item.href}
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-electric transition-colors hover:text-white"
                >
                  {item.cta}
                  <span aria-hidden="true">&rsaquo;</span>
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ----------------------------------------- Page ---------------------------------------- */

export function HowItWorksStory() {
  return (
    <div className="relative overflow-hidden pt-28 pb-8 sm:pt-32">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(ellipse_90%_60%_at_50%_-10%,rgba(59,130,246,0.14),transparent_60%)]" />

      <Container className="max-w-3xl">
        <Reveal>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-electric">
            How it works
          </p>
          <h1 className="mt-3 font-display text-4xl leading-tight text-white sm:text-5xl">
            People are the bridge.
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-white/65">
            Not a warehouse. Not a catalogue. A trip becomes an opportunity, and an
            opportunity becomes a favour worth paying for. Here&apos;s how it plays out
            for two members — Jill and Nathan.
          </p>
        </Reveal>
      </Container>

      <div className="mt-8 sm:mt-14">
        <Scene number="01" eyebrow="The Trip" illustrationSide="right" illustration={<TripIllustration />}>
          <h2 className="font-display text-3xl leading-tight text-white sm:text-4xl">
            Jill is flying London to Kutaisi.
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/65 sm:text-lg">
            It isn&apos;t a common route. That&apos;s exactly why she posts it before she
            flies — while it can still help someone.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <InfoCard kind="status" label="Status" text="Flying to Kutaisi next week." />
            <InfoCard
              kind="opportunity"
              label="Opportunity"
              text="8 kg luggage space. Can source small local items."
            />
          </div>
        </Scene>

        <Scene number="02" eyebrow="The Spark" illustrationSide="left" illustration={<SparkIllustration />}>
          <h2 className="font-display text-3xl leading-tight text-white sm:text-4xl">
            Nathan sees the opportunity.
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/65 sm:text-lg">
            A notification reaches Nathan. He remembers a handmade blue ceramic cup
            from a Kutaisi market — the kind you can&apos;t find anywhere else — and
            sends a sourcing request.
          </p>
          <div className="mt-6 max-w-sm">
            <ChatBubble from="Nathan" align="left">
              Any chance you could find a small handmade ceramic cup? Blue glaze,
              like the ones from the market.
            </ChatBubble>
          </div>
        </Scene>

        <Scene
          number="03"
          eyebrow="The Agreement"
          illustrationSide="right"
          illustration={<AgreementIllustration />}
        >
          <h2 className="font-display text-3xl leading-tight text-white sm:text-4xl">
            Jill agrees to source it.
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/65 sm:text-lg">
            Before anything is bought, the terms are clear — photos first, then
            Nathan chooses the price, the fee, and how it travels.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <TermPill icon={Camera} text="Photos first" />
            <TermPill icon={Tag} text="Clear price + fee" />
            <TermPill icon={Package} text="Ship or carry" />
          </div>
        </Scene>

        <Scene
          number="04"
          eyebrow="The Sourcing"
          illustrationSide="left"
          illustration={<SourcingIllustration />}
        >
          <h2 className="font-display text-3xl leading-tight text-white sm:text-4xl">
            Found, photographed, purchased.
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/65 sm:text-lg">
            Jill visits the market, sends photos for approval, and buys the cup once
            Nathan confirms. Now: ship it ahead, or carry it home herself.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <TermPill icon={Store} text="Local market" />
            <TermPill icon={Camera} text="Photo approval" />
            <TermPill icon={CheckCircle2} text="Purchased" />
          </div>
        </Scene>

        <Scene number="05" eyebrow="The Bridge" illustrationSide="right" illustration={<HandoverIllustration />}>
          <h2 className="font-display text-3xl leading-tight text-white sm:text-4xl">
            Both benefit.
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-white/65 sm:text-lg">
            Nathan gets a piece he couldn&apos;t have found alone. Jill earns from a
            trip she was already taking. Neither needed a warehouse — just each
            other.
          </p>
        </Scene>
      </div>

      <Reveal className="mx-auto max-w-3xl px-5 py-16 text-center sm:py-24">
        <p className="font-display text-3xl leading-snug text-white sm:text-5xl">
          People are the bridge.
          <br />
          Location is the value.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <PrimaryButton href="/explore" className="btn-glow-primary">
            Explore the Network
          </PrimaryButton>
          <SecondaryButton href="/join" className="btn-glow-secondary">
            Create Your Profile
          </SecondaryButton>
        </div>
      </Reveal>

      <UseCases />
    </div>
  );
}
