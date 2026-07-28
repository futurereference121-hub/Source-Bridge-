import { redirect } from "next/navigation";

type Props = {
  searchParams: Promise<{ c?: string }>;
};

/** Legacy /messages → /inbox */
export default async function MessagesRedirect({ searchParams }: Props) {
  const sp = await searchParams;
  if (sp.c) redirect(`/inbox/${sp.c}`);
  redirect("/inbox");
}
