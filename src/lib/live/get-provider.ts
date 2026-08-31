import { isLiveStreamMockProvider } from "./flags";
import { mockLiveVideoProvider } from "./mock-provider";
import { cloudflareLiveVideoProvider } from "./cloudflare";
import type { LiveVideoProvider } from "./provider";

export function getLiveVideoProvider(): LiveVideoProvider {
  if (isLiveStreamMockProvider()) return mockLiveVideoProvider;
  return cloudflareLiveVideoProvider;
}
