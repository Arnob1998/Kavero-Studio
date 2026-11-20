"use client";

import Image from 'next/image';
import { useState } from 'react';
import styles from './model-hub.module.css';
import { localPublisherLogo } from './popular-image-models';

/** HF resolves this public endpoint for both user and organization publishers. */
export function PublisherAvatar({ publisher }: { publisher: string }) {
  const src = localPublisherLogo(publisher) ?? `https://huggingface.co/api/avatars/${encodeURIComponent(publisher)}`;
  const [failed, setFailed] = useState<string | null>(null);
  return <span className={styles.publisherMark}>
    {failed === src ? <span aria-hidden>{publisher.slice(0, 2).toUpperCase()}</span> : <Image
      src={src} alt={`${publisher} publisher avatar`} width={40} height={40}
      unoptimized loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(src)}
    />}
  </span>;
}
