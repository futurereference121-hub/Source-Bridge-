import { prisma } from "@/lib/db";
import {
  canTransitionLifecycle,
  type OpportunityLifecycle,
} from "@/lib/opportunities/lifecycle";
import { resolveLifecycle } from "@/lib/opportunities/map";

/** When someone messages about an OPEN opportunity, move to IN_DISCUSSION. */
export async function markOpportunityInDiscussion(
  opportunityId: string,
): Promise<void> {
  const row = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
  });
  if (!row) return;
  const current = resolveLifecycle(row);
  const target: OpportunityLifecycle = "IN_DISCUSSION";
  if (!canTransitionLifecycle(current, target)) return;
  if (current === target) return;
  await prisma.opportunity.update({
    where: { id: opportunityId },
    data: {
      lifecycle: target,
      stateChangedAt: new Date(),
    },
  });
}
