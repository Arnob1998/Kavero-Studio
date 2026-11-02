"use client";

import { useEffect, useId, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import type { HubLicense } from "./model-hub-contract";
import styles from "./model-hub.module.css";

export function publisherLink(value: string | null | undefined) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function ModelLicenseDialog({ title, license, onClose }: { title: string; license: HubLicense | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); }; }, []);
  const href = publisherLink(license?.sourceUrl);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
    <div className={styles.heading}>
      <div><h2 id={titleId}>{title}</h2><p>{license?.identifier ?? "Unknown license"}</p></div>
      <button className={styles.button} onClick={() => ref.current?.close()} aria-label="Close license"><X size={16} /></button>
    </div>
    <div className={styles.dialogBody}>
      <p className={styles.muted}>{license?.attribution === "cached-model-card" ? "Publisher model-card attribution. Review the full terms at the source." : "Cached upstream text for this inspected revision."}</p>
      {href && <a className={styles.license} href={href} target="_blank" rel="noopener noreferrer">Read at source <ExternalLink size={12} /></a>}
      {license?.text ? <pre className={styles.licenseText} tabIndex={0}>{license.text.content}</pre> : <p className={styles.empty}>License text is unavailable. Review the publisher’s terms before using this model.</p>}
    </div>
  </dialog>;
}
