"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Container } from "@/components/ui/Container";
import { useAppUi } from "@/components/providers/AppProviders";
import { IdentityStep } from "@/components/onboarding/IdentityStep";
import { LocationStep } from "@/components/onboarding/LocationStep";
import { HelpStep } from "@/components/onboarding/HelpStep";

type Step = "identity" | "location" | "help";

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
    slug?: string;
    complete?: boolean;
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
  const [finishing, setFinishing] = useState(false);

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
    if (account.onboardingComplete && account.slug) {
      router.replace(`/members/${account.slug}`);
      return;
    }
    if (account.onboardingComplete) {
      router.replace("/explore");
      return;
    }
    setIdentity((prev) => ({
      ...prev,
      fullName: prev.fullName || account.name || "",
      username: prev.username || account.username || "",
      photo: prev.photo || account.photo || "",
    }));
  }, [authReady, account, router]);

  if (
    !authReady ||
    !account ||
    !account.emailVerified ||
    account.onboardingComplete ||
    finishing
  ) {
    return (
      <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
        <Container className="max-w-xl">
          <p className="text-white/50">
            {finishing ? "Opening your profile…" : "Loading…"}
          </p>
        </Container>
      </div>
    );
  }

  const stepIndex =
    step === "identity" ? 1 : step === "location" ? 2 : 3;

  return (
    <div className="bg-app-navy min-h-[100svh] pt-28 pb-24 text-white sm:pt-32">
      <Container className="max-w-xl">
        <p className="text-xs uppercase tracking-[0.16em] text-electric">
          Step {stepIndex} of 3
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-white">
          Set up your profile
        </h1>
        <p className="mt-3 text-white/55">
          A few steps so others know who you are and how you can help.
        </p>

        <div className="mt-10">
          {step === "identity" ? (
            <IdentityStep
              userId={account.id}
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
                setFinishing(true);
                try {
                  const data = await postOnboarding({
                    step: "help",
                    specialties: values.specialties,
                    publicDisplayMessage: values.publicDisplayMessage,
                    statusText: values.statusText || undefined,
                    opportunity: values.opportunity,
                  });
                  await refreshAccount();
                  const next =
                    data.next ||
                    (data.slug ? `/members/${data.slug}?welcome=1` : "/explore");
                  router.replace(next);
                } catch (err) {
                  setFinishing(false);
                  showToast(
                    err instanceof Error ? err.message : "Could not finish profile",
                  );
                }
              }}
            />
          ) : null}
        </div>
      </Container>
    </div>
  );
}
