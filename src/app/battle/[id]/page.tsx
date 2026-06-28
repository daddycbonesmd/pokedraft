import Battle from "@/components/Battle";

export default async function BattlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Battle id={id} />;
}
