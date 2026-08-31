import { Container } from "@/components/ui/Container";
import { GoLiveStudio } from "@/components/live/GoLiveStudio";

export default function GoLivePage() {
  return (
    <div className="min-h-[100svh] bg-app-navy pb-24 pt-28 text-white">
      <Container className="max-w-lg">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-electric">
          Source Bridge Live
        </p>
        <h1 className="mt-2 font-display text-3xl text-white">Go Live</h1>
        <p className="mt-2 text-sm text-white/60">
          30 minutes. Capture Item lets buyers message you with the frame they
          actually paused on.
        </p>
        <div className="mt-8">
          <GoLiveStudio />
        </div>
      </Container>
    </div>
  );
}
