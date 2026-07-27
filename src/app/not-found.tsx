import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] items-center pt-28 pb-20">
      <Container className="text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">404</p>
        <h1 className="mt-4 font-display text-4xl text-ink sm:text-5xl">
          Page not found
        </h1>
        <p className="mx-auto mt-4 max-w-md text-muted">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Button href="/">Home</Button>
          <Button href="/explore" variant="outline">
            Explore
          </Button>
        </div>
        <p className="mt-8 text-sm text-muted">
          Or{" "}
          <Link href="/contact" className="text-accent underline-offset-2 hover:underline">
            contact us
          </Link>
          .
        </p>
      </Container>
    </div>
  );
}
