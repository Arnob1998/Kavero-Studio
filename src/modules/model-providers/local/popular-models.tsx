"use client";

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Box, Layers3, X } from 'lucide-react';
import { popularImageModels, type PopularImageFamily } from './popular-image-models';
import { PublisherAvatar } from './publisher-avatar';
import styles from './model-hub.module.css';

export function PopularModels({ onSelect, disabled }: { onSelect: (model: { id: string }) => void; disabled: boolean }) {
  const [family, setFamily] = useState<PopularImageFamily | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!family) return;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const current = dialog.current; current?.showModal();
    return () => { current?.close(); trigger.current?.focus(); };
  }, [family]);
  return <section className={styles.discover} aria-labelledby="popular-models-heading">
    <div className={styles.discoverHeading}><div><span className={styles.sourceLabel}>THE DEFAULT COLLECTION</span><h2 id="popular-models-heading">Popular image models.</h2><p>A starting collection of established model families. Open a model to choose a version and inspect its files.</p></div></div>
    <div className={styles.modelGrid}>
      {popularImageModels.families.map(model => <article key={model.id} className={styles.discoveryCard}>
        <button className={styles.discoveryCardButton} disabled={disabled} onClick={() => setFamily(model)} aria-label={`View ${model.name}`}>
          <div className={styles.discoveryIdentity}><PublisherAvatar publisher={model.publisher}/><span className={styles.repositoryIdentity}><span>{model.publisher}</span><strong>{model.name}</strong></span><ArrowRight size={16} className={styles.cardArrow}/></div>
          <p className={styles.familyDescription}>{model.description}</p>
          <div className={styles.discoveryFooter}><span><Layers3 size={13}/>{model.repositories.length} {model.repositories.length === 1 ? 'version' : 'versions'}</span></div>
        </button>
      </article>)}
    </div>
    <p className={styles.collectionNote}>Popular does not mean compatible. Available files, licenses and runtime support are checked when you inspect a repository.</p>
    {family && <dialog ref={dialog} className={`${styles.dialog} ${styles.addDialog}`} aria-labelledby="family-detail-title" onClose={() => setFamily(null)}>
      <div className={styles.heading}><div className={styles.modelIdentity}><PublisherAvatar publisher={family.publisher}/><div><h2 id="family-detail-title">{family.name}</h2><p>{family.publisher}</p></div></div><button className={styles.iconButton} aria-label="Close model family" onClick={() => setFamily(null)}><X size={18}/></button></div>
      <div className={styles.dialogBody}><p className={styles.muted}>{family.description}</p><section className={styles.fileChoices} aria-labelledby="family-versions-title"><div><h3 id="family-versions-title">Choose a version</h3><p className={styles.muted}>We’ll fetch the latest repository metadata and available files from Hugging Face. Selecting a version does not download model weights.</p></div>
        {family.repositories.map(repository => <button key={repository.id} className={styles.fileChoice} disabled={disabled} aria-label={`Inspect ${repository.id}`} onClick={() => { setFamily(null); onSelect({ id: repository.id }); }}><Box size={17}/><span><strong>{repository.label}</strong><small>{repository.kind === 'official' ? 'Official publisher' : 'Community package'} · {repository.id}</small></span><ArrowRight size={15}/></button>)}
      </section><p className={styles.collectionNote}>Review the repository’s files and license before continuing to model setup.</p></div>
    </dialog>}
  </section>;
}
