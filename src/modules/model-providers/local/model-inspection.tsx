"use client";
import { ArrowRight, Box, ExternalLink, FileBadge2 } from 'lucide-react';
import type { HubSnapshot, HubLicense } from './model-hub-contract';
import styles from './model-hub.module.css';
export function recipeStatus(value: string) {
  return ({ "known-recipe": "Compatible recipe", "needs-variant": "Choose a variant", "needs-components": "Component check incomplete", "unsupported-runtime": "Unsupported runtime", "revision-changed": "Publisher revision changed", "access-required": "Publisher access required", "unsupported-format": "Unsupported model format" } as Record<string, string>)[value] ?? "Inspection unavailable";
}
const roleLabel = (role: string) => ({ "image-weights": "Image model", "text-encoder": "Text encoder", vae: "VAE", engine: "Engine" } as Record<string, string>)[role] ?? role;
export function Inspection({ snapshot, onLicense, onVariant, disabled }: { snapshot: HubSnapshot; onLicense: (title: string, value: HubLicense | null) => void; onVariant: (file: string) => void; disabled: boolean }) {
  return <>
    <dl className={styles.facts}>
      <div><dt>Variant</dt><dd>{snapshot.selectedFile?.name ?? "Not selected"}</dd></div>
      <div><dt>Model size</dt><dd>{snapshot.selectedFile?.bytes != null ? `${(snapshot.selectedFile.bytes / 1024 ** 3).toFixed(2)} GB · weights only` : "Unknown"}</dd></div>
      <div><dt>Revision</dt><dd>{snapshot.revision?.slice(0, 12) ?? "Unverified"}</dd></div>
      <div><dt>License</dt><dd><button className={styles.license} onClick={() => onLicense("Model license", snapshot.license)}><FileBadge2 size={14} strokeWidth={1.75} aria-hidden/>{snapshot.license?.identifier ?? "Unknown"} <ExternalLink size={11} /></button></dd></div>
      <div><dt>Hardware</dt><dd>Not checked by inspection</dd></div>
    </dl>
    {snapshot.recipeSupport === "needs-variant" && <section className={styles.fileChoices} aria-labelledby="model-files-heading"><div><h3 id="model-files-heading">Choose a model file</h3><p className={styles.muted}>Files published in this repository. Sizes below are weights only.</p></div>{snapshot.variants.map(file=><button key={file.name} className={styles.fileChoice} disabled={disabled} onClick={()=>onVariant(file.name)} aria-label={`Check ${file.name}`}><Box size={17}/><span><strong>{file.name}</strong><small>{file.bytes===null?'Size unknown':`${(file.bytes/1024**3).toFixed(2)} GB`}</small></span><ArrowRight size={15}/></button>)}</section>}
    {snapshot.readme?.text&&<details className={styles.publisherDescription}><summary>About this model</summary><p>{snapshot.readme.text.slice(0,2500)}</p></details>}
    {snapshot.components.length > 0 && <><h3 className="text-xs font-medium">Components & licenses</h3>{snapshot.components.map(component => <div className={styles.component} key={component.role}><span>{roleLabel(component.role)}<span className={styles.description}>{component.status === "verified-metadata" ? "Metadata verified" : component.status === "pinned-recipe-only" ? "Pinned engine" : "Needs verification"}</span></span><button className={styles.license} aria-label={`View ${roleLabel(component.role)} license`} onClick={() => onLicense(`${roleLabel(component.role)} license`, component.license)}>{component.license.identifier ?? "Unknown"}</button></div>)}</>}
    <p className={`${styles.muted} mt-5`}>{snapshot.recipeSupport === "known-recipe" ? "The source matches a verified recipe. Installation, hardware readiness and generation are checked separately." : snapshot.recipeSupport === "needs-variant" ? "This repository contains multiple weight files. Pick the version you want to inspect." : snapshot.recipeSupport === "revision-changed" ? "The publisher updated this repository. It no longer matches the pinned recipe; a newer revision has not been verified." : snapshot.recipeSupport === "needs-components" ? "One or more required components could not be verified. Inspection does not authorize installation." : snapshot.recipeSupport === "access-required" ? "This repository requires publisher access. Gated and private downloads are not supported here yet." : "This source has no complete verified recipe for Kavero’s managed runtime. It can be inspected, but cannot be installed or used."}</p>
  </>;
}
