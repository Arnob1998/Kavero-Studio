"use client";
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleHelp, CircleX, Loader2, ShieldCheck } from 'lucide-react';
import { compatibilityResult, type CompatibilityResult, type ModelDestination } from './compatibility-contract';
import { hubSource, type HubSource, type HubLicense } from './model-hub-contract';
import { Inspection } from './model-inspection';
import { ModelLicenseDialog } from './model-license-dialog';
import styles from './model-hub.module.css';
import {RemoteSetupActions} from './connect/remote-setup-controls';
import type {RemoteSetupControl} from './connect/use-remote-setup';
import type {Computer} from './connect/computer-contract';

export function ModelCompatibilityPreview({ ownerId, source, destination, destinationName, showDetails = false, remoteSetup,computer }: {
  ownerId: string; source: HubSource; destination: ModelDestination; destinationName: string; showDetails?: boolean; remoteSetup?:RemoteSetupControl;computer?:Computer;
}) {
  const [file, setFile] = useState<string | null>(null);
  const [record, setRecord] = useState<{ key: string; result?: CompatibilityResult; error?: string; busy?: boolean } | null>(null);
  const [license, setLicense] = useState<{ title: string; value: HubLicense | null } | null>(null);
  const controller = useRef<AbortController | null>(null), revision = useRef(0);
  const destinationKey = JSON.stringify(destination), sourceKey = JSON.stringify(source);
  useEffect(() => {
    setFile(null); setLicense(null);
    return () => { revision.current++; controller.current?.abort(); };
  }, [ownerId, destinationKey, sourceKey]);
  const effective = file ? { ...source, preferredFile: file } : source;
  const identity = (value: HubSource) => JSON.stringify([ownerId, value, destination]);
  const current = record?.key === identity(effective) ? record : null;
  useEffect(() => {
    const result = record?.result; if (!result) return;
    const remaining = Math.max(0, Math.min(150000, Date.parse(result.expiresAt) - Date.parse(result.checkedAt), Date.parse(result.expiresAt) - Date.now()));
    const deadline = Date.now() + remaining;
    const expire = () => setRecord(previous => previous === record ? { key: record.key, error: 'These checks are out of date. Refresh to verify this computer again.' } : previous);
    const visible = () => { if (Date.now() >= deadline || Date.now() >= Date.parse(result.expiresAt)) expire(); };
    const timer = setTimeout(expire, remaining);
    document.addEventListener('visibilitychange', visible);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [record]);
  async function check(selectedFile?: string) {
    const selected = selectedFile ? { ...source, preferredFile: selectedFile } : effective;
    if (selectedFile) setFile(selectedFile);
    const key = identity(selected), epoch = ++revision.current;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setRecord({ key, busy: true });
    try {
      const response = await fetch('/api/local-generation/compatibility', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'content-type': 'application/json', 'x-kavero-connect-owner': ownerId },
        body: JSON.stringify({ source: selected, destination }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(75000)]) });
      const data = await response.json(); if (!response.ok) throw Error(data.error || 'Model checks could not be completed.');
      const result = compatibilityResult.parse(data);
      if (result.ownerId !== ownerId || JSON.stringify(result.destination) !== destinationKey || JSON.stringify(result.source) !== JSON.stringify(hubSource.parse(selected))) throw Error('The model, account or computer changed. Check again.');
      if (revision.current === epoch && !abort.signal.aborted) setRecord({ key, result });
    } catch (error) { if (revision.current === epoch && !abort.signal.aborted) setRecord({ key, error: error instanceof Error ? error.message : 'Checks are unavailable.' }); }
  }
  return <section className={styles.compatibility} aria-label={`Compatibility on ${destinationName}`}>
    <div className={styles.compatibilityHeading}><div><h3><ShieldCheck size={15}/>Check on {destinationName}</h3><p>Read-only checks. No model files are downloaded.</p></div><button className={styles.button} disabled={current?.busy} onClick={() => void check()}>{current?.busy && <Loader2 size={14} className="animate-spin"/>}{current?.busy ? 'Checking model…' : current?.result ? 'Refresh checks' : 'Check model compatibility'}</button></div>
    {current?.error && <p role="alert" className={styles.error}>{current.error}</p>}
    {current?.result && <><div className={styles.checkGrid} aria-live="polite">{(['runtime','hardware','storage','access','availability'] as const).map(key => {
      const evidence = current.result![key];
      return <div key={key} className={styles.checkRow} data-state={evidence.state}><span>{evidence.state === 'pass' ? <CheckCircle2 size={16}/> : evidence.state === 'blocked' ? <CircleX size={16}/> : <CircleHelp size={16}/>}</span><div><strong>{{runtime:'Runtime support',hardware:'Hardware',storage:'Storage',access:'Permission',availability:'Availability'}[key]}<small>{evidence.state === 'pass' ? 'Verified' : evidence.state === 'blocked' ? 'Needs attention' : 'Not verified'}</small></strong><p>{evidence.message}</p></div></div>;
    })}</div><p className={styles.collectionNote}>Checked for {current.result.destinationName}. {current.result.ready ? 'This exact installed workload has current readiness evidence.' : 'No installation or execution permission is granted by this preview.'}</p>
    {showDetails && current.result.snapshot && <Inspection snapshot={current.result.snapshot} disabled={!!current.busy} onVariant={selected => void check(selected)} onLicense={(title, value) => setLicense({ title, value })}/>}</>}
    {current?.result&&remoteSetup&&destination.kind==='remote'&&<RemoteSetupActions key={identity(effective)} result={current.result} control={remoteSetup} computer={computer}/>}
    {license && <ModelLicenseDialog title={license.title} license={license.value} onClose={() => setLicense(null)}/>}
  </section>;
}
