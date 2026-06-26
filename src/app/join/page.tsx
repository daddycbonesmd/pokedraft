import JoinLeague from "@/components/JoinLeague";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  return <JoinLeague initialCode={code ?? ""} />;
}
