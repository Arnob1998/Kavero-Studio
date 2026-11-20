import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { GeneratePage } from "@/modules/generation/components/generate-page";
import { localUIEnabled } from "@/modules/generation/local/readiness-service";
import { connectWebsiteEnabled } from "@/modules/model-providers/local/connect/computer-service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Generate | ${brand.name}`,
  description: `Generate AI images in ${brand.name} and send them into the design editor.`,
};

export default async function Page() {
  const connectEnabled=connectWebsiteEnabled();
  const ownerId=connectEnabled?(await (await createClient()).auth.getUser()).data.user?.id:undefined;
  return <GeneratePage localEnabled={localUIEnabled()} connectOwnerId={ownerId} />;
}
