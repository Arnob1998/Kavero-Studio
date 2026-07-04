import { ClientApp } from "@/modules/canvas/components/canvas-app";

interface DesignPageProps {
  params: Promise<{ designId: string }>;
}

export default async function DesignPage({ params }: DesignPageProps) {
  const { designId } = await params;

  return <ClientApp initialDesignId={designId} />;
}
