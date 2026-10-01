/**
 * Permanent refusal for temporary Preview diagnostic mutations.
 * No database client and no Stripe client. Fixture rows are left unchanged.
 */

export type DisabledDiagnosticAction = "e2e" | "restore";

export function disabledDiagnosticMutation(action: DisabledDiagnosticAction) {
  return {
    ok: false as const,
    status: "GP_DIAGNOSTIC_MUTATION_DISABLED" as const,
    action,
    blocker: "diagnostic_mutation_disabled" as const,
    stripe_writes: 0 as const,
    db_writes: 0 as const,
    production_untouched: true as const,
    connect_untouched: true as const,
  };
}
