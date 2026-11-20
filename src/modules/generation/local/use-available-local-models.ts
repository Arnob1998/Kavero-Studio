"use client";
import { useEffect, useState } from 'react';
import { localProfiles, type LocalProfile } from '@/modules/model-providers/local/browser-profiles';
import { setupSnapshotSchema } from './setup-contract';

export function useAvailableLocalModels(enabled: boolean) {
  const [available, setAvailable] = useState<LocalProfile[]>([]);
  useEffect(() => {
    setAvailable([]); if (!enabled) return;
    let live=true,timer:ReturnType<typeof setTimeout>;
    const abort=new AbortController();
    const poll=async()=>{
      try {
        const rows=await Promise.all(localProfiles.map(async profile=>{
          const response=await fetch(`/api/local-generation/setup?view=model&profile=${profile.profile}`,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(25000)])});
          if(!response.ok)throw Error('unavailable');
          const data=await response.json(),snapshot=setupSnapshotSchema.parse(data.setup);
          const delivery=profile.profile===localProfiles[0].profile?'qwen-2-1-research-delivery-v1':'qwen-2-1-q3-research-delivery-v1';
          if(typeof data.ownerId!=='string'||!data.ownerId||snapshot.manifest!==profile.manifest||snapshot.packageId!==delivery||snapshot.operation&&snapshot.operation.packageId!==delivery)throw Error('identity-changed');
          const usable=snapshot.installed&&snapshot.accepted&&snapshot.available&&snapshot.supported&&!['admitted','downloading','verifying','staged','activating','cancelling','removed','failed','activation-failed','interrupted'].includes(snapshot.operation?.state??'');
          return {owner:data.ownerId,profile:profile.profile,usable};
        }));
        if(rows.some(row=>row.owner!==rows[0].owner))throw Error('owner-changed');
        if(live)setAvailable(rows.filter(row=>row.usable).map(row=>row.profile));
      }catch{if(live)setAvailable([]);}
      finally{if(live)timer=setTimeout(poll,4000);}
    };
    void poll();return()=>{live=false;abort.abort();clearTimeout(timer);};
  },[enabled]);
  return available;
}
