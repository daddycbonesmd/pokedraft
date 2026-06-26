import Room from "@/components/Room";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <Room code={code.toUpperCase()} />;
}
