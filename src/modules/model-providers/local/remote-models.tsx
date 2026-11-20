"use client";

import Link from 'next/link';
import { Monitor, Link2 } from 'lucide-react';
import { useState } from 'react';
import { ConnectedComputers } from './connect/connected-computers';
import type { Computer } from './connect/computer-contract';
import { RemoteModelCatalog } from './remote-model-catalog';
import styles from './model-hub.module.css';

export function RemoteModels({ enabled, ownerId,setupEnabled=false }: { enabled: boolean; ownerId?: string;setupEnabled?:boolean }) {
  return <div className={styles.root}>
    <div className={styles.libraryToolbar}><div><h2>Remote</h2><p>Use models running on a computer connected to your account.</p></div></div>
    {!enabled ? <section className={styles.remoteUnavailable} aria-labelledby="remote-unavailable-title"><span className={styles.modelIcon}><Monitor size={20}/></span><div><h3 id="remote-unavailable-title">Remote access isn’t available on this installation yet.</h3><p>Local models and cloud providers are still available. Remote connections need Kavero Connect enabled by the installation owner.</p></div></section>
      : !ownerId ? <section className={styles.remoteUnavailable}><span className={styles.modelIcon}><Link2 size={20}/></span><div><h3>Sign in to connect a computer</h3><p>Your remote computers and model access are linked to your account.</p><Link className={styles.button} href="/auth/login">Sign in</Link></div></section>
      : <RemoteWorkspace key={ownerId} ownerId={ownerId} setupEnabled={setupEnabled}/>}
  </div>;
}
function RemoteWorkspace({ ownerId,setupEnabled }: { ownerId: string;setupEnabled:boolean }) {
  const [computers, setComputers] = useState<Computer[] | null>(null);
  return <><ConnectedComputers ownerId={ownerId} onComputersChange={setComputers}/><RemoteModelCatalog ownerId={ownerId} computers={computers} setupEnabled={setupEnabled}/></>;
}
