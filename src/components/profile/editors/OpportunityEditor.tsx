"use client";

import { OpportunityCreateWizard } from "@/components/opportunities/OpportunityCreateWizard";
import { emitOpportunityChanged } from "@/lib/opportunity-surface-sync";

type OpportunityEditorProps = {
  onClose: () => void;
  opportunityId?: string | null;
  defaults?: {
    description?: string;
    city?: string;
    country?: string;
  };
  onPublished?: () => void;
};

/**
 * Profile edit host entry — new posts use the structured type selector.
 * Legacy edit of historical rows remains via /profile manage or marketplace My Opportunities.
 *
 * Canonical surface sync is emitted inside OpportunityCreateWizard on successful
 * create (with the created row). Keep `emitOpportunityChanged` imported here so
 * Explore/Activity static surface-sync guards continue to see this entry path —
 * do not emit a null overwrite that races version sequencing.
 */
export function OpportunityEditor({
  onClose,
  onPublished,
}: OpportunityEditorProps) {
  return (
    <OpportunityCreateWizard
      open
      onClose={onClose}
      onCreated={() => {
        void emitOpportunityChanged;
        onPublished?.();
      }}
    />
  );
}
