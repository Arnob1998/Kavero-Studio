import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { GeneratePage } from "@/modules/generation/components/generate-page";

export const metadata: Metadata = {
  title: `Generate | ${brand.name}`,
  description: `Generate AI images in ${brand.name} and send them into the design editor.`,
};

export default function Page() {
  return <GeneratePage />;
}
