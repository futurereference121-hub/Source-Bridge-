import { redirect } from "next/navigation";

/** Legacy route — listed purchases live under Protected Payments. */
export default function AdminPurchasesRedirect() {
  redirect("/admin/payments#listed-product-purchases");
}
