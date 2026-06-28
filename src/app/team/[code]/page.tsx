import Teambuilder from "@/components/Teambuilder";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <Teambuilder code={code.toUpperCase()} />;
}
