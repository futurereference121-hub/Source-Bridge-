# Live payments activation checklist

**Do not set LIVE_PAYMENTS_ENABLED=true until every item is checked.**

- [ ] Legal review of buyer/seller Protected Payment terms complete
- [ ] Stripe Connect enabled; platform country confirmed for Separate Charges and Transfers
- [ ] If country cannot support SCT — architecture escalation completed (no silent Destination Charges switch)
- [ ] Live Stripe keys provisioned via Vercel/CLI (never chat)
- [ ] Live webhook endpoints + secrets configured
- [ ] TEST mode end-to-end: ticket → fund → track → inspect → release → refund/dispute
- [ ] Admin financial dashboard ops runbook reviewed
- [ ] Tracking production provider configured
- [ ] Feature flags rollout plan (payments → protected → instant → procurement)
- [ ] Code review: `getStripeMode()` / live key refusal still correct
- [ ] Explicit product decision to enable live (not automatic)
