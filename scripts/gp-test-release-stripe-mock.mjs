/** In-process Stripe SDK double for the TEST release route regression. */
export default class Stripe {
  constructor() {
    this.paymentIntents = {
      retrieve: async (id) => ({ id, latest_charge: "ch_test_connect", currency: "gbp" }),
    };
    this.charges = {
      retrieve: async (id) => ({
        id,
        currency: "gbp",
        amount: 1070,
        balance_transaction: { currency: "gbp", amount: 1070 },
      }),
    };
    this.transfers = {
      create: async (params) => {
        globalThis.__SB_HTTP_LOG?.push({
          method: "POST",
          path: "/v1/transfers",
          body: params,
          rawBody: "",
          idempotencyKey: null,
        });
        return { id: "tr_test_connect", object: "transfer" };
      },
    };
  }
}
