import FormatBuilder from "@/components/FormatBuilder";

export default async function BuildPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return <FormatBuilder editId={id} />;
}
