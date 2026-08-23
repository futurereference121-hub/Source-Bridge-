import { SourceBridgeLoader } from "@/components/ui/SourceBridgeLoader";

/** Local loading for admin tab transitions — keeps admin chrome mounted. */
export default function AdminLoading() {
  return (
    <div className="py-16" data-testid="admin-loading">
      <SourceBridgeLoader label="Loading admin…" />
    </div>
  );
}
