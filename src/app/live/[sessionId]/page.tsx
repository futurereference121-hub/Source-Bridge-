import { Container } from "@/components/ui/Container";
import { LiveWatchClient } from "@/components/live/LiveWatchClient";

type Props = {
  params: Promise<{ sessionId: string }>;
};

export default async function LiveWatchPage({ params }: Props) {
  const { sessionId } = await params;
  return (
    <div className="min-h-[100svh] bg-app-navy pb-24 pt-28 text-white">
      <Container className="max-w-lg">
        <LiveWatchClient sessionId={sessionId} />
      </Container>
    </div>
  );
}
