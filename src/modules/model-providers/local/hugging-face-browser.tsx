"use client";

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ArrowRight, Box, Download, Heart, ImageIcon, RefreshCw, Search } from 'lucide-react';
import { huggingFacePage, type HuggingFaceModel } from './hugging-face-contract';
import styles from './model-hub.module.css';
import { PublisherAvatar } from './publisher-avatar';
import { PopularModels } from './popular-models';

type Page = ReturnType<typeof huggingFacePage.parse>;
const count = (value: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
export function HuggingFaceBrowser({ onSelect, disabled, initialView = 'popular', scope = 'local' }: { onSelect: (model: { id: string }) => void; disabled: boolean; initialView?: 'popular' | 'hub'; scope?: 'local'|'remote' }) {
  const [view, setView] = useState(initialView);
  return <div className={styles.root}>
    <div className={styles.collectionTabs} role="group" aria-label="Model collection"><button aria-pressed={view === 'popular'} onClick={() => setView('popular')}>Popular models</button><button aria-pressed={view === 'hub'} onClick={() => setView('hub')}>Browse Hugging Face</button></div>
    {view === 'popular' ? <PopularModels onSelect={onSelect} disabled={disabled}/> : <LiveHuggingFaceBrowser onSelect={onSelect} disabled={disabled} scope={scope}/>}
  </div>;
}
function LiveHuggingFaceBrowser({ onSelect, disabled, scope }: { onSelect: (model: HuggingFaceModel) => void; disabled: boolean; scope:'local'|'remote' }) {
  const [input, setInput] = useState(''), [search, setSearch] = useState('');
  const [format, setFormat] = useState('all'), [task, setTask] = useState('text-to-image');
  const [cursors, setCursors] = useState<string[]>([]), [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null), [refresh, setRefresh] = useState(0);
  const cursor = cursors.at(-1) ?? '';
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setPage(null);
    const query = new URLSearchParams({ discover: '1', search, format, task, ...(scope==='remote'?{scope}:{}), ...(cursor ? { cursor } : {}) });
    void fetch(`/api/local-generation/models?${query}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(16000)]) })
      .then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error || 'Hugging Face is unavailable.'); return huggingFacePage.parse(data); })
      .then(data => { if (!controller.signal.aborted) setPage(data); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Models could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [search, format, task, cursor, refresh, scope]);

  return <section className={styles.discover} aria-labelledby="discover-models-heading">
    <div className={styles.discoverHeading}><div><span className={styles.sourceLabel}><Image src="/llm-providers/huggingface-icon.png" alt="" width={16} height={16}/>FROM HUGGING FACE</span><h2 id="discover-models-heading">Find your next image model.</h2><p>Explore community models. Check compatibility and choose files before downloading.</p></div><span className={styles.sourceStamp}>Live catalog <span aria-hidden>↗</span></span></div>
    <div className={styles.searchToolbar}>
      <form className={styles.modelSearch} role="search" onSubmit={event => { event.preventDefault(); setCursors([]); setSearch(input.trim()); setRefresh(value => value + 1); }}>
        <Search size={17} aria-hidden/><input aria-label="Search Hugging Face models" placeholder="Search models, publishers, or architectures…" value={input} maxLength={120} onChange={event => setInput(event.target.value)}/><button type="submit" aria-label="Search models"><ArrowRight size={17}/></button>
      </form>
      <select className={styles.browserFilter} aria-label="Image task" value={task} onChange={event => { setTask(event.target.value); setCursors([]); }}><option value="text-to-image">Text to image</option><option value="image-to-image">Image to image</option></select>
      <select className={styles.browserFilter} aria-label="Model format" value={format} onChange={event => { setFormat(event.target.value); setCursors([]); }}><option value="all">All formats</option><option value="gguf">GGUF</option></select>
    </div>
    <div className={styles.resultsHeading}><span>{search ? `Results for “${search}”` : 'Explore image models'}</span><span>Most downloaded</span></div>
    <div aria-live="polite" aria-busy={loading}>
      {loading ? <div className={styles.modelGrid} aria-label="Loading Hugging Face models">{Array.from({ length: 6 }, (_, index) => <div key={index} className={styles.modelSkeleton}><span/><span/><span/></div>)}</div> : error ? <div className={styles.browserEmpty}><Box size={26}/><h3>Couldn’t load Hugging Face</h3><p>{error}</p><button className={styles.button} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={14}/>Try again</button></div> : !page?.models.length ? <div className={styles.browserEmpty}><Search size={26}/><h3>No models found</h3><p>Try another name or format. You can also add a repository link above.</p></div> : <div className={styles.modelGrid}>
        {page.models.map(model => <article key={model.id} className={styles.discoveryCard}>
          <button className={styles.discoveryCardButton} disabled={disabled} onClick={() => onSelect(model)} aria-label={`View ${model.id}`}>
            <div className={styles.discoveryIdentity}><PublisherAvatar publisher={model.author}/><span className={styles.repositoryIdentity}><span>{model.author}</span><strong>{model.name}</strong></span><ArrowRight size={16} className={styles.cardArrow}/></div>
            <div className={styles.discoveryTags}><span><ImageIcon size={12}/>{model.task === 'text-to-image' ? 'Text to image' : 'Image to image'}</span><span>{model.format}</span>{model.gated && <span>Access required</span>}</div>
            <div className={styles.discoveryFooter}><span><Download size={13}/>{count(model.downloads)}<span className={styles.metricLabel}>downloads</span></span><span><Heart size={13}/>{count(model.likes)}</span><span className={styles.cardLicense}>{model.license ?? 'License unspecified'}</span></div>
          </button>
        </article>)}
      </div>}
    </div>
    {(cursors.length > 0 || page?.nextCursor) && <div className={styles.browserPagination}><button className={styles.button} disabled={loading || !cursors.length} onClick={() => setCursors(value => value.slice(0, -1))}>Previous</button><span>Page {cursors.length + 1}</span><button className={styles.button} disabled={loading || !page?.nextCursor} onClick={() => { if (page?.nextCursor) setCursors(value => [...value, page.nextCursor!]); }}>Next</button></div>}
  </section>;
}
