"use client";
import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { HuggingFaceBrowser } from './hugging-face-browser';
import { ModelCompatibilityPreview } from './model-compatibility-preview';
import type { Computer } from './connect/computer-contract';
import styles from './model-hub.module.css';
import {useRemoteSetup} from './connect/use-remote-setup';
import {RemoteSetupTracker} from './connect/remote-setup-controls';

export function RemoteModelCatalog({ ownerId, computers,setupEnabled=false }: { ownerId: string; computers: Computer[] | null;setupEnabled?:boolean }) {
  const setup=useRemoteSetup(ownerId,setupEnabled);
  const [chosen, setChosen] = useState(''), [source, setSource] = useState<{ id: string; source: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(null);
  const available = computers?.filter(computer => !['revoked','expired'].includes(computer.status)) ?? [];
  const selected = available.find(computer => computer.id === chosen) ?? (!chosen && available.length === 1 ? available[0] : undefined);
  useEffect(() => {
    if (!source) return;
    const current = dialog.current; trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    current?.showModal(); return () => { current?.close(); trigger.current?.focus(); };
  }, [!!source]);
  return <section className={styles.root} aria-label="Remote model catalog">
    <div className={styles.libraryToolbar}><div><h2>Models for your computer</h2><p>Choose a destination before checking a model. Remote installation is managed in Kavero Connect.</p></div><button className={styles.button} disabled={!selected} onClick={() => setSource({ id: `model-${crypto.randomUUID()}`, source: '' })}><Plus size={14}/>Check a model link</button></div>
    <label className={styles.destinationSelector}>Check on<select className={styles.input} aria-label="Model destination" value={selected?.id ?? ''} onChange={event => setChosen(event.target.value)}><option value="">Choose a computer</option>{available.map(computer => <option key={computer.id} value={computer.id}>{computer.name} · {computer.status}</option>)}</select></label>
    {!selected && <p className={styles.muted}>{computers === null ? 'Computer status is not verified. Refresh the connection above.' : 'Connect and choose a computer to check a model. Browsing does not install anything.'}</p>}
    {setupEnabled&&<RemoteSetupTracker control={setup} computers={computers}/>}
    <HuggingFaceBrowser scope="remote" disabled={!selected} onSelect={model => setSource({ id: `model-${crypto.randomUUID()}`, source: `https://huggingface.co/${model.id}` })}/>
    {source && <dialog ref={dialog} className={`${styles.dialog} ${styles.addDialog}`} aria-labelledby="remote-model-title" onClose={event => { if (event.target === event.currentTarget) setSource(null); }}>
      <div className={styles.heading}><div><h2 id="remote-model-title">Remote model details</h2><p>{selected ? `Checking for ${selected.name}` : 'Choose a destination to continue.'}</p></div><button className={styles.iconButton} aria-label="Close remote model" onClick={() => setSource(null)}><X size={18}/></button></div>
      <div className={styles.dialogBody}><label htmlFor="remote-model-link" className={styles.muted}>Hugging Face model link</label><input id="remote-model-link" className={styles.input} type="url" value={source.source} maxLength={1024} placeholder="https://huggingface.co/owner/model" onChange={event => setSource({ ...source, source: event.target.value })}/>
        {selected && source.source ? <ModelCompatibilityPreview key={source.id} showDetails ownerId={ownerId} source={source} destination={{ kind: 'remote', deviceId: selected.id }} destinationName={selected.name} remoteSetup={setupEnabled?setup:undefined} computer={selected}/> : <p className={styles.muted}>Enter a model link and choose an available account computer.</p>}
      </div>
    </dialog>}
  </section>;
}
