"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, FolderLock, HardDrive, Loader2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DeploymentProfile } from "@/lib/deployment-profile";
import { cn } from "@/lib/utils";
import { getSettingsCopy } from "../settings-copy";

type DriveStatus = {
  connected: boolean;
  plan: "free" | "premium";
  usage: {
    used: number;
    limit: number | null;
  };
  connection: {
    googleEmail: string | null;
    folderId: string;
    folderName: string;
    scope: string;
    connectedAt: string;
    updatedAt: string;
  } | null;
};

export function StorageSettingsPanel({
  deploymentProfile = "cloud",
}: {
  deploymentProfile?: DeploymentProfile;
}) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const settingsCopy = getSettingsCopy(deploymentProfile);
  const isLocalFirst = settingsCopy.deploymentProfile === "local-first";

  useEffect(() => {
    if (isLocalFirst) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadStatus() {
      try {
        const response = await fetch("/api/google-drive/status");
        if (!response.ok) return;
        const payload = (await response.json()) as DriveStatus;
        if (isMounted) setStatus(payload);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadStatus();

    return () => {
      isMounted = false;
    };
  }, [isLocalFirst]);

  if (isLocalFirst) {
    return <LocalFirstStoragePanel copy={settingsCopy.storagePanel} />;
  }

  async function disconnect() {
    setIsDisconnecting(true);
    const response = await fetch("/api/google-drive/disconnect", { method: "POST" });
    if (response.ok) {
      setStatus((current) => ({
        connected: false,
        plan: current?.plan ?? "free",
        usage: current?.usage ?? { used: 0, limit: 20 },
        connection: null,
      }));
    }
    setIsDisconnecting(false);
  }

  const connection = status?.connection ?? null;

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.045] shadow-[0_24px_90px_rgb(0_0_0_/_0.36),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-xl">
      <div className="flex flex-col justify-between gap-4 border-b border-white/[0.08] p-5 sm:flex-row sm:items-center">
        <div className="flex gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-white/66">
            <HardDrive size={19} />
          </div>
          <div>
            <h2 className="m-0 text-[18px] font-semibold tracking-normal text-white">
              {settingsCopy.storagePanel.title}
            </h2>
            <p className="m-0 mt-1 max-w-[70ch] text-[13px] font-medium leading-5 text-white/48">
              {settingsCopy.storagePanel.description}
              {status?.usage
                ? status.usage.limit === null
                  ? " Premium storage is active."
                  : ` Free storage: ${status.usage.used}/${status.usage.limit} images used.`
                : ""}
            </p>
          </div>
        </div>

        {isLoading ? (
          <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.045] px-4 text-[12px] font-semibold text-white/58">
            <Loader2 size={15} className="animate-spin" />
            Checking
          </span>
        ) : status?.connected ? (
          <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-accent/35 bg-accent/12 px-4 text-[12px] font-semibold text-blue-100">
            <CheckCircle2 size={15} className="text-accent" />
            Connected
          </span>
        ) : (
          <Button asChild className="h-10 rounded-xl bg-accent px-4 text-white hover:bg-accent-hover">
            <a href="/api/google-drive/connect?next=/settings/storage">
              Connect Drive
              <ExternalLink size={15} />
            </a>
          </Button>
        )}
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-3">
          <StorageRow label="Folder" value={connection?.folderName ?? "Not connected"} />
          <StorageRow label="Google account" value={connection?.googleEmail ?? "Available after connecting"} />
          <StorageRow label="OAuth scope" value={connection?.scope ?? "drive.file"} />
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-black/24 p-4">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.07] text-white/64">
              <FolderLock size={17} />
            </div>
            <div>
              <p className="m-0 text-[14px] font-semibold text-white">
                {settingsCopy.storagePanel.summaryTitle}
              </p>
              <p className="m-0 mt-0.5 text-[12px] font-medium leading-5 text-white/42">
                {settingsCopy.storagePanel.summaryDescription}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button asChild variant="secondary" className="w-full">
              <Link href="/gallery">Open Gallery</Link>
            </Button>
            <Button
              variant="secondary"
              className={cn("w-full", !status?.connected && "hidden")}
              disabled={isDisconnecting}
              onClick={() => void disconnect()}
            >
              <Unplug size={15} />
              {isDisconnecting ? "Disconnecting..." : "Disconnect"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function LocalFirstStoragePanel({ copy }: { copy: ReturnType<typeof getSettingsCopy>["storagePanel"] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.045] shadow-[0_24px_90px_rgb(0_0_0_/_0.36),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-xl">
      <div className="flex flex-col justify-between gap-4 border-b border-white/[0.08] p-5 sm:flex-row sm:items-center">
        <div className="flex gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-white/66">
            <HardDrive size={19} />
          </div>
          <div>
            <h2 className="m-0 text-[18px] font-semibold tracking-normal text-white">
              {copy.title}
            </h2>
            <p className="m-0 mt-1 max-w-[70ch] text-[13px] font-medium leading-5 text-white/48">
              {copy.description}
            </p>
          </div>
        </div>

        <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-accent/35 bg-accent/12 px-4 text-[12px] font-semibold text-blue-100">
          <CheckCircle2 size={15} className="text-accent" />
          {copy.badge}
        </span>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-3">
          {copy.details.map((detail) => (
            <StorageRow key={detail.label} label={detail.label} value={detail.value} />
          ))}
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-black/24 p-4">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.07] text-white/64">
              <FolderLock size={17} />
            </div>
            <div>
              <p className="m-0 text-[14px] font-semibold text-white">{copy.summaryTitle}</p>
              <p className="m-0 mt-0.5 text-[12px] font-medium leading-5 text-white/42">
                {copy.summaryDescription}
              </p>
            </div>
          </div>

          <Button asChild variant="secondary" className="w-full">
            <Link href="/gallery">Open Gallery</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

function StorageRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
      <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-white/34">{label}</p>
      <p className="m-0 mt-2 break-words text-[14px] font-semibold text-white/76">{value}</p>
    </div>
  );
}
