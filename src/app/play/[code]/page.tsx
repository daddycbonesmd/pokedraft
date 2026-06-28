import Play from "@/components/Play";

export default async function PlayPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <Play code={code.toUpperCase()} />;
}
