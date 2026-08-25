import { redirect } from "next/navigation";

type Props = { params: Promise<{ txnId: string }> };

/** Legacy detail URL — listed purchases expand in place under Protected Payments. */
export default async function AdminProtectedPurchaseDetailRedirect({
  params,
}: Props) {
  const { txnId } = await params;
  // Hash fragment is client-only; land on listed section. Accordion can be opened from list.
  void txnId;
  redirect("/admin/payments#listed-product-purchases");
}
