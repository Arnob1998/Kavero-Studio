import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { brand } from "@/lib/brand";
import { HomeContent } from "./home-content";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Kavero | Generate images. Design on canvas.",
  description: "Generate images, shape them on canvas, and keep your creative work together. An open-source workspace with your choice of AI and storage.",
  applicationName: brand.name,
};
type HomePageProps = { searchParams?: Promise<{tab?: string}> | {tab?: string} };
export default async function HomePage({searchParams}:HomePageProps = {}) {
  const params=searchParams?await searchParams:{};
  if(params.tab==="apps"||params.tab==="learn") redirect("/dashboard?tab="+params.tab);
  return <HomeContent/>;
}
