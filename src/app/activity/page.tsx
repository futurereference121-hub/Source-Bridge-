import type { Metadata } from "next";
import { ActivityClient } from "./ActivityClient";

export const metadata: Metadata = {
  title: "Live Activity",
  description: "Recent member status updates and opportunities on Source Bridge.",
};

export default function ActivityPage() {
  return <ActivityClient />;
}
