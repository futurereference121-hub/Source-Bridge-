"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useAppUi } from "@/components/providers/AppProviders";
import { IdentityStep } from "@/components/onboarding/IdentityStep";
import { LocationStep } from "@/components/onboarding/LocationStep";
import { HelpStep } from "@/components/onboarding/HelpStep";

type Step = "identity" | "location" | "help" | "done";

async function postOnboarding(body: Record<string, unknown>) {
  const res = await fetch("/api/onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    error?: string;
    message?: string;
    next?: string;
  };
  if (!res.ok) throw new Error(data.error || "Onboarding failed");
  return data;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { account, authReady, refreshAccount, showToast } = useAppUi();
  const [step, setStep] = useState<Step>("identity");
  const [identity, setIdentity] = useState({
    username: "",
    fullName: "",
    bio: "",
    photo: "",
    cover: "",
  });
  const [location, setLocation] = useState({
    city: "",
    country: "",
    network: [] as { city: string; country: string }[],
    trips: [] as {
      city: string;
      country: string;
      arrival: string;
      departure: string;
    }[],
  });

  useEffect(() => {
    if (!authReady) return;
    if (!account) {
      router.replace("/join");
      return;
    }
    if (!account.emailVerified) {
      router.replace("/check-email");
      return;
    }
    if (account.onboardingComplete) {
      router.replace("/profile");
      return;
    }
    setIdentity((prev) => ({
      ...prev,
      fullName: prev.fullName || account.name || "",
      username: prev.username || account.username || "",
      photo: prev.photo || account.photo || "",
    }));
  }, [authReady, account, router]);

  if (!authReady || !account || !account.emailVerified || account.onboardingComplete) {
    return (
      <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
        <Container className="max-w-xl">
          <p className="text-white/50">Loading…</p>
        </Container>
      </div>
    );
  }

  const stepIndex =
    step === "identity" ? 1 : step === "location" ? 2 : step === "help" ? 3 : 3;

  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-24 text-white sm:pt-32">
      <Container className="max-w-xl">
        {step !== "done" ? (
          <>
            <p className="text-xs uppercase tracking-[0.16em] text-electric">
              Step {stepIndex} of 3
            </p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight text-white">
              Set up your profile
            </h1>
            <p className="mt-3 text-white/55">
              A few steps so others know who you are and how you can help.
            </p>
          </>
        ) : null}

        <div className="mt-10">
          {step === "identity" ? (
            <IdentityStep
              initial={identity}
              showToast={showToast}
              onContinue={async (values) => {
                try {
                  await postOnboarding({ step: "identity", ...values });
                  setIdentity(values);
                  setStep("location");
                } catch (err) {
                  showToast(
                    err instanceof Error ? err.message : "Could not save identity",
                  );
                }
              }}
            />
          ) : null}

          {step === "location" ? (
            <LocationStep
              initial={location}
              showToast={showToast}
              onContinue={async (values) => {
                try {
                  await postOnboarding({ step: "location", ...values });
                  setLocation(values);
                  setStep("help");
                } catch (err) {
                  showToast(
                    err instanceof Error ? err.message : "Could not save location",
                  );
                }
              }}
            />
          ) : null}

          {step === "help" ? (
            <HelpStep
              showToast={showToast}
              onFinish={async (values) => {
                try {
                  const data = await postOnboarding({
                    step: "help",
                    specialties: values.specialties,
                    publicDisplayMessage: values.publicDisplayMessage,
                    statusText: values.statusText || undefined,
                    opportunity: values.opportunity,
                  });
                  await refreshAccount();
                  showToast(data.message || "Profile ready");
                  setStep("done");
                } catch (err) {
                  showToast(
                    err instanceof Error ? err.message : "Could not finish",
                  );
                }
              }}
            />
          ) : null}

          {step === "done" ? (
            <div className="panel-navy rounded-xl px-5 py-8 text-center sm:px-8">
              <h2 className="text-3xl font-bold tracking-tight text-white">
                Your Source Bridge profile is ready.
              </h2>
              <p className="mt-3 text-white/60">
                Manage your status, opportunities, and network from your profile.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <PrimaryButton href="/profile" showArrow={false}>
                  Go to profile
                </PrimaryButton>
                <Link
                  href="/explore"
                  className="inline-flex h-12 items-center rounded-lg border border-white/15 px-5 text-sm font-medium text-white/80 hover:border-electric/40"
                >
                  Explore members
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </Container>
    </div>
  );
}
