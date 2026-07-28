import type { Metadata } from "next";
import { Suspense } from "react";
import { Container } from "@/components/ui/Container";
import { CheckoutPageClient } from "./CheckoutPageClient";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `Checkout · ${slug}`,
  };
}

export default async function CheckoutPage({ params }: PageProps) {
  const { slug } = await params;
  return (
    <Suspense
      fallback={
        <div className="bg-app-navy min-h-[100svh] pt-28 pb-20 text-white">
          <Container className="max-w-2xl">
            <p className="text-white/50">Loading checkout…</p>
          </Container>
        </div>
      }
    >
      <CheckoutPageClient slug={slug} />
    </Suspense>
  );
}
