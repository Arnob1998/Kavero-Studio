import type { Metadata } from "next";
import { ClientApp } from "@/modules/canvas/components/canvas-app";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Canvas | ${brand.name}`,
  description: "Create and edit Kavero canvas designs.",
};

export default function CanvasPage() {
  return <ClientApp initialDesignId={null} />;
}
