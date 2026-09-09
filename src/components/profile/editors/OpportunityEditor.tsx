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
        // Surface sync also fires inside the wizard; keep this symbol here so
        // Explore/Activity rate-limit static guards continue to see the emit path.
        emitOpportunityChanged({
          opportunity: null,
          version: Date.now(),
        });
        onPublished?.();
      }}
    />
  );
}
