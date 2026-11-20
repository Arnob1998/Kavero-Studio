import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { context, owner, RequestError, readConnectBody, connectError, connectJSON as reply } from './service';
import { setupGate, setupOwnerCommand, setupIntent, setupRequestView, setupPreparation } from './setup-contract';
import { assertLocalResources } from '../failure';
import { canonicalSnapshot, jobSnapshotForProfile } from '../job-snapshot';
import { digest } from './protocol';
import audit from '../../../../../scripts/local-generation/install/qwen-research-audit.json';

const device = z.object({ id: z.string().uuid(), installation_id: z.string().uuid(), key_version: z.number().int().positive(), revoked_at: z.string().nullable(), expires_at: z.string() });
async function prepare(admin:ReturnType<typeof createAdminClient>,ownerId:string,origin:string,deviceId:string,intent:z.infer<typeof setupIntent>){
  const {data,error}=await admin.rpc('connect_setup_owner',{p_owner:ownerId,p_origin:origin,p_action:'prepare',p_input:{deviceId,intent}});
  if(error||!data||data.error)throw new RequestError(503,'Computer setup could not be verified. Try again.');
  const value=z.object({capable:z.boolean(),seenAt:z.string().nullable(),deviceName:z.string().min(1).max(60),assessment:setupRequestView.nullable(),active:setupRequestView.nullable()}).strict().parse(data);
  const now=Date.now(),intentHash=digest(canonicalSnapshot(intent)),assessment=value.assessment;
  if(assessment&&(assessment.kind!=='assess'||assessment.state!=='assessed'||assessment.intentHash!==intentHash||canonicalSnapshot(assessment.intent)!==canonicalSnapshot(intent)))throw Error('setup-assessment-changed');
  if(value.active&&(value.active.intent.ownerId!==ownerId||value.active.intent.origin!==origin||value.active.deviceId!==deviceId))throw Error('setup-destination-changed');
  const seen=Date.parse(value.seenAt??''),capable=value.capable&&seen>now-150000&&seen<=now+60000,evidence=assessment?.evidence;
  const measured=Date.parse(evidence?.capturedAt??''),fresh=!!evidence&&measured>now-150000&&measured<=now+60000;
  let installable=false,message='Check this computer to verify the model and available resources.';
  if(!capable)message='Open or update Kavero Connect on this computer and confirm your account there.';
  else if(value.active)message='Finish or cancel the existing setup request on this computer first.';
  else if(fresh&&evidence){
    if(evidence.compatibility!=='eligible')message=`This computer did not pass the native requirement check (${evidence.compatibility}).`;
    else if(evidence.freeVramMiB===null||evidence.freeRamBytes===null||evidence.freeDiskBytes===null||evidence.requiredFreeBytes===null)message='Available memory or disk space is unknown. Check again in Kavero Connect.';
    else if(evidence.freeDiskBytes<evidence.requiredFreeBytes)message='Free disk space is below the space required for this model and its components.';
    else try{assertLocalResources({freeVramMiB:evidence.freeVramMiB,freeRamBytes:evidence.freeRamBytes,freeDiskBytes:evidence.freeDiskBytes});installable=true;message='Native checks passed. Download still needs approval on this computer.';}catch{message='Available memory is below the native minimum. Close other GPU apps and check again.';}
  }
  const expiresAt=new Date(Math.max(now,Math.min(now+150000,capable?seen+150000:now+150000,fresh?measured+150000:now+150000))).toISOString();
  return setupPreparation.parse({setupProtocol:1,intent,intentHash,deviceName:value.deviceName,expiresAt,capable,installable,message,assessment,active:value.active,notices:audit.termsFiles.map(f=>({name:f.path.split('/').at(-1),sha256:f.sha256}))});
}
export async function setupsPOST(request: Request) {
  try {
    const origin = context(request), gate = setupGate(); if (gate) throw new RequestError(gate.status, gate.error);
    const ownerId = await owner(request, origin), input = setupOwnerCommand.parse((await readConnectBody(request)).input);
    const admin = createAdminClient(); let body: Record<string, unknown> = input;
    if(input.action==='create'){
      const recovered=await admin.rpc('connect_setup_owner',{p_owner:ownerId,p_origin:origin,p_action:'recover',p_input:{key:input.key}});
      if(recovered.error||!recovered.data)throw Error('setup-storage-unavailable');
      if(!recovered.data.error){const original=setupRequestView.parse(recovered.data.request);
        if(original.key!==input.key||original.intent.ownerId!==ownerId||original.intent.origin!==origin||original.deviceId!==input.deviceId||original.kind!==input.kind||original.intent.profile!==input.profile||input.kind==='install'&&original.intentHash!==input.reviewHash)return reply({error:'The original setup request has a different identity.'},409);
        return reply({setupProtocol:1,request:original});
      }
      if(recovered.data.error!=='not-found')throw Error('setup-storage-unavailable');
    }
    if (input.action === 'create' || input.action === 'review' || input.action==='prepare') {
      const { data, error } = await admin.from('connect_devices').select('id,installation_id,key_version,revoked_at,expires_at').eq('id', input.deviceId).eq('owner_id', ownerId).eq('origin', origin).maybeSingle();
      const parsed = device.safeParse(data);
      if (error) throw Error('setup-storage-unavailable');
      if (!parsed.success || parsed.data.revoked_at || Date.parse(parsed.data.expires_at) <= Date.now()) throw new RequestError(404, 'Computer not found.');
      const snapshot = jobSnapshotForProfile(input.profile);
      const intent = setupIntent.parse({ setupProtocol: 1, ownerId, origin, deviceId: input.deviceId, installationId: parsed.data.installation_id, keyVersion: parsed.data.key_version, profile: input.profile,
        manifestHash: snapshot.manifestHash, termsDigest: audit.termsIdentity, purpose: 'research-evaluation', recipeHash: digest(canonicalSnapshot(snapshot)) });
      const intentHash = digest(canonicalSnapshot(intent));
      if(input.action==='prepare')return reply(await prepare(admin,ownerId,origin,input.deviceId,intent));
      if (input.action === 'review') return reply({ setupProtocol: 1, intent, intentHash });
      if (input.kind === 'install' && input.reviewHash !== intentHash) return reply({error:'Model or destination review changed. Review again.',notSubmitted:true},409);
      if(input.kind==='install') {const checked=await prepare(admin,ownerId,origin,input.deviceId,intent);if(!checked.installable)return reply({error:checked.message,notSubmitted:true},409);}
      body = { id: randomUUID(), key: input.key, deviceId: input.deviceId, kind: input.kind, acceptedTerms: input.kind === 'install', intent, intentHash };
    }
    const { data, error } = await admin.rpc('connect_setup_owner', { p_owner: ownerId, p_origin: origin, p_action: input.action, p_input: body });
    if (error || !data) throw Error('setup-storage-unavailable');
    if (data.error) return reply({ error: data.error,...(input.action==='create'&&['setup-capability-unavailable','queue-full','receipt-capacity','rate-limited','intent-invalid'].includes(data.error)?{notSubmitted:true}:{}) }, data.error === 'not-found' ? 404 : ['rate-limited','queue-full','receipt-capacity'].includes(data.error) ? 429 : data.error === 'unauthorized' ? 401 : 409);
    return reply({ setupProtocol: 1, request: setupRequestView.parse(data.request) });
  } catch (error) { return connectError(error); }
}
