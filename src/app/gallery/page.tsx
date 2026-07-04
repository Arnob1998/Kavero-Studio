import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, FolderLock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brand } from "@/lib/brand";
import { getDeploymentProfile, isLocalFirstDeploymentProfile } from "@/lib/deployment-profile";
import { getGenerationLimit, normalizeUserPlan } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";

import { GalleryShell } from "@/modules/gallery/components/gallery-shell";
import { EmptyState } from "@/modules/gallery/components/empty-state";
import { GalleryGenerationActions } from "@/modules/gallery/components/gallery-generation-actions";
import { GalleryCard } from "@/modules/gallery/components/gallery-card";
import { GenerationFolderCard } from "@/modules/gallery/components/generation-folder-card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Gallery | ${brand.name}`,
  description: "Browse generated image history saved to Google Drive.",
};

import type { GalleryFolder, GalleryImage, GalleryRun } from "@/modules/gallery/types";
import { getGalleryFolders } from "@/modules/gallery/utils/gallery-folders";
import { getGalleryData } from "@/modules/gallery/persistence/get-gallery-data";

export default async function GalleryPage({
  searchParams,
}: {
  searchParams?: Promise<{ generation?: string }>;
}) {
  const selectedGenerationId = (await searchParams)?.generation;
  const deploymentProfile = getDeploymentProfile();
  const isLocalFirst = isLocalFirstDeploymentProfile(deploymentProfile);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <GalleryShell>
        <EmptyState
          title="Sign in to open Gallery"
          description="Your generated image history is attached to your account and Drive connection."
          actionHref="/auth/login?next=/gallery"
          actionLabel="Sign in"
        />
      </GalleryShell>
    );
  }

  const { connection, runs, metadata, generationCount } = await getGalleryData(supabase, user.id);

  if (!connection && !isLocalFirst) {
    return (
      <GalleryShell>
        <EmptyState
          title="Connect Google Drive"
          description="Free plan generations are saved to a scoped Drive folder before they appear here."
          actionHref="/api/google-drive/connect?next=/gallery"
          actionLabel="Connect Drive"
        />
      </GalleryShell>
    );
  }

  const folders = getGalleryFolders(runs);
  const selectedFolder = selectedGenerationId
    ? folders.find((folder) => folder.id === selectedGenerationId)
    : null;
  const visibleImages = selectedFolder?.images ?? [];
  const plan = normalizeUserPlan(metadata?.plan);
  const generationLimit = getGenerationLimit(plan);
  const usedGenerations = generationCount ?? folders.length;
  const storageLabel = isLocalFirst ? "Kavero storage" : connection?.folder_name;
  const galleryDescription = isLocalFirst
    ? "Generated images saved through Kavero storage."
    : `Generated images saved to ${connection?.google_email ?? "your connected Google Drive"}.`;
  const emptyDescription = isLocalFirst
    ? "Generate an image and it will appear here from Kavero storage with its prompt and settings."
    : "Generate an image after Drive is connected and it will appear here with its prompt and settings.";

  return (
    <GalleryShell>
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0">
          {selectedFolder ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Link
                className="inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] font-semibold text-white/54 transition hover:bg-white/[0.07] hover:text-white"
                href="/gallery"
              >
                <ArrowLeft size={15} />
                Back
              </Link>
              <span className="inline-flex h-8 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.045] px-3 text-[12px] font-medium text-white/50">
                <FolderLock size={13} />
                {storageLabel}
              </span>
            </div>
          ) : null}
          {!selectedFolder ? (
            <div className="mb-3 inline-flex h-8 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.045] px-3 text-[12px] font-medium text-white/50">
              <FolderLock size={13} />
              {storageLabel}
            </div>
          ) : null}
          {selectedFolder ? (
            <h1 className="m-0 text-[clamp(42px,6vw,86px)] font-light leading-none tracking-normal text-white">
              Prompt
            </h1>
          ) : (
            <h1 className="m-0 text-[clamp(42px,6vw,86px)] font-light leading-none tracking-normal text-white">
              Gallery
            </h1>
          )}
          <div className="mt-4 max-w-[820px]">
            <p className="m-0 text-[14px] font-medium leading-6 text-white/50">
              {selectedFolder ? selectedFolder.prompt : galleryDescription}
            </p>
            <p className="m-0 mt-3 text-[12px] font-semibold text-white/36">
              {generationLimit === null
                ? "Premium storage is active."
                : `${usedGenerations}/${generationLimit} generations used.`}
            </p>
          </div>
        </div>
        <Button asChild variant="secondary" className="h-11 rounded-xl">
          <Link href="/settings/storage">
            Storage settings
            <ExternalLink size={15} />
          </Link>
        </Button>
      </div>

      {folders.length === 0 ? (
        <EmptyState
          title="No saved generations yet"
          description={emptyDescription}
          actionHref="/generate"
          actionLabel="Generate"
        />
      ) : selectedFolder ? (
        <>
          <div className="mb-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-end">
            <GalleryGenerationActions generationId={selectedFolder.id} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visibleImages.map((image) => (
              <GalleryCard key={image.id} image={image} folder={selectedFolder} />
            ))}
          </div>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {folders.map((folder) => (
            <GenerationFolderCard key={folder.id} folder={folder} />
          ))}
        </div>
      )}
    </GalleryShell>
  );
}
