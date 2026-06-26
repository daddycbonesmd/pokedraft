import TournamentView from "@/components/Tournament";

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <TournamentView code={code.toUpperCase()} />;
}
