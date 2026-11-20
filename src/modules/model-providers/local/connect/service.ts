import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { browserCommand, claimCommand, deviceCommand, jobCommand, manageDeviceCommand, publicKey, uuid } from "./contracts";
import { claimMessage, connectOrigin, deviceMessage, digest, publicIdentity, verifyConnect } from "./protocol";

import { canonicalSnapshot, jobRequestHash, jobSnapshotForProfile } from "../job-snapshot";
import { setupDeviceCommand, setupDeviceView, setupGate } from './setup-contract';

const json = (body: unknown, status = 200) => {
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded) > 32768) return Response.json({ error: "Connect response exceeds its limit." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  return new Response(encoded, { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
};
export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function context(request: Request) {
  if (process.env.KAVERO_CONNECT_ENABLED !== "1") throw new RequestError(404, "Connect is not enabled.");
  const configured = process.env.KAVERO_CONNECT_ORIGIN;
  if (!configured) throw Error("connect-origin-unconfigured");
  const origin = connectOrigin(configured, process.env.NODE_ENV !== "production" && process.env.KAVERO_CONNECT_ALLOW_LOOPBACK === "1");
  // Next.js/reverse proxies can use an internal request origin. Bind proofs and
  // browser mutations to configured origin, never Host/Forwarded or request URL.
  if (new URL(request.url).search) throw new RequestError(400, "Invalid Connect endpoint.");
  return origin;
}
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "Missing request.");
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 8192) { await reader.cancel(); throw new RequestError(413, "Connect request too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  return { text, input: JSON.parse(text) as unknown };
}
export async function owner(request: Request, origin: string) {
  if (request.method !== "GET" && request.headers.get("origin") !== origin) throw new RequestError(403, "Confirm from the Kavero website.");
  const client = await createClient(); const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new RequestError(401, "Sign in to manage connected computers.");
  const expectedOwner=request.headers.get("x-kavero-connect-owner");
  if(expectedOwner&&expectedOwner!==user.id)throw new RequestError(409,"Your account changed. Reload before continuing.");
  return user.id;
}
function result(data: unknown, error: unknown, extra?: Record<string, unknown>) {
  if (error || !data || typeof data !== "object" || Array.isArray(data)) throw Error("connect-storage-unavailable");
  const value = data as Record<string, unknown>;
  if (typeof value.error === "string") {
    const status = value.error === "unauthorized" ? 401 : value.error === "not-found" ? 404 : value.error === "rate-limited" ? 429 : 409;
    return json({ error: value.error }, status);
  }
  return json({ version: 1, ...value, ...extra });
}
function handleError(error: unknown) {
  if (error instanceof RequestError) return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError) return json({ error: "Invalid Connect request." }, 400);
  return json({ error: "Connect is unavailable. Retry later." }, 503);
}

export async function pairingsPOST(request: Request) {
  try {
    const origin = context(request), userId = await owner(request, origin);
    const input = browserCommand.parse((await readBody(request)).input);
    const code = input.action === "create" ? randomBytes(12).toString("hex") : undefined;
    const body = input.action === "create" ? { name: input.name, codeHash: digest(code!) } : input;
    const { data, error } = await createAdminClient().rpc("connect_owner", { p_owner: userId, p_origin: origin, p_action: input.action, p_input: body });
    return result(data, error, code ? { code } : undefined);
  } catch (error) { return handleError(error); }
}
export async function pairingsGET(request: Request) {
  try {
    // This endpoint alone has a single owner-filtered id query.
    const url = new URL(request.url), id = uuid.parse(url.searchParams.get("id"));
    if ([...url.searchParams.keys()].length !== 1) throw new RequestError(400, "Invalid pairing query.");
    const clean = new Request(new URL(url.pathname, url.origin), request);
    const origin = context(clean), userId = await owner(clean, origin);
    const { data, error } = await createAdminClient().rpc("connect_owner", { p_owner: userId, p_origin: origin, p_action: "inspect", p_input: { id } });
    return result(data, error);
  } catch (error) { return handleError(error); }
}
export async function devicesGET(request: Request) {
  try {
    const origin = context(request), userId = await owner(request, origin);
    const { data, error } = await createAdminClient().rpc("connect_owner", { p_owner: userId, p_origin: origin, p_action: "list", p_input: {} });
    return result(data, error);
  } catch (error) { return handleError(error); }
}
export async function devicesPOST(request: Request) {
  try {
    const origin = context(request), userId = await owner(request, origin);
    const input = manageDeviceCommand.parse((await readBody(request)).input);
    const { data, error } = await createAdminClient().rpc("connect_owner", { p_owner: userId, p_origin: origin, p_action: input.action, p_input: input });
    return result(data, error);
  } catch (error) { return handleError(error); }
}
export async function claimPOST(request: Request) {
  try {
    const origin = context(request);
    if (request.headers.has("origin")) throw new RequestError(403, "Companion requests only.");
    const input = claimCommand.parse((await readBody(request)).input);
    if (!verifyConnect(claimMessage(origin, input.code, input.installationId, input.publicKey, input.deviceId), input.proof, input.publicKey)) throw new RequestError(401, "Invalid companion proof.");
    const { data, error } = await createAdminClient().rpc("connect_claim", { p_origin: origin, p_input: {
      codeHash: digest(input.code), installationId: input.installationId, deviceId: input.deviceId, publicKey: input.publicKey, fingerprint: digest(input.publicKey),
    } });
    return result(data, error);
  } catch (error) { return handleError(error); }
}
function deliveryEnabled() {
  if (process.env.KAVERO_CONNECT_DELIVERY_ENABLED !== "1") throw new RequestError(404, "Connect delivery is not enabled.");
}
function executionEnabled() {
  if (process.env.KAVERO_CONNECT_EXECUTION_ENABLED !== "1") throw new RequestError(404, "Connect execution is not enabled.");
}
export async function jobsPOST(request: Request) {
  try {
    const origin = context(request); deliveryEnabled();
    const userId = await owner(request, origin);
    const input = jobCommand.parse((await readBody(request)).input);
    if (input.action === "create" && input.execute) executionEnabled();
    let body: Record<string, unknown> = input;
    if (input.action === "create") {
      const recipeSnapshot = jobSnapshotForProfile(input.profile);
      const intent = {profile:input.profile,prompt:input.prompt,width:512,height:512,count:1};
      body = {...input,id:randomUUID(),intent,recipeSnapshot,hash:jobRequestHash(intent,recipeSnapshot)};
    }
    const {data,error} = await createAdminClient().rpc("connect_job_owner", {p_owner:userId,p_origin:origin,p_action:input.action,p_input:body});
    const executing = !!(data as {job?:{payload?:{execute?:boolean}}})?.job?.payload?.execute;
    return result(data,error,executing ? {protocolOnly:false,generationEnabled:process.env.KAVERO_CONNECT_EXECUTION_ENABLED === "1"} : undefined);
  } catch(error) { return handleError(error); }
}
export async function devicePOST(request: Request) {
  try {
    const origin = context(request);
    if (request.headers.has("origin")) throw new RequestError(403, "Companion requests only.");
    const id = uuid.parse(request.headers.get("x-kavero-connect-device"));
    const nonce = uuid.parse(request.headers.get("x-kavero-connect-nonce"));
    const timestamp = request.headers.get("x-kavero-connect-time") ?? "";
    if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60000) throw new RequestError(401, "Expired device request.");
    const { text, input: raw } = await readBody(request), input = z.union([deviceCommand,setupDeviceCommand]).parse(raw);
    const setup = input.action === 'setup-poll' || input.action === 'setup-checkpoint';
    if (setup) { const gate=setupGate(); if(gate)throw new RequestError(gate.status,gate.error); }
    const execution = input.action === "execution-poll" || input.action === "execution-checkpoint";
    if (execution) executionEnabled();
    const delivery = execution || input.action === "delivery-poll" || input.action === "delivery-checkpoint";
    if (delivery) deliveryEnabled();
    const admin = createAdminClient();
    const { data: device, error: lookupError } = await admin.from("connect_devices").select("public_key,revoked_at,expires_at").eq("id", id).eq("origin", origin).maybeSingle();
    if (lookupError) throw Error("device-storage-unavailable");
    if (!device || device.revoked_at || Date.parse(device.expires_at) <= Date.now()
      || !verifyConnect(deviceMessage(origin, id, timestamp, nonce, text), request.headers.get("x-kavero-connect-signature") ?? "", device.public_key)) throw new RequestError(401, "Device authorization failed.");
    if (input.action === "rotate") {
      try { publicIdentity(publicKey.parse(input.publicKey)); }
      catch { throw new RequestError(400, "Invalid replacement key."); }
    }
    let body: Record<string,unknown> = execution ? {...input,execute:true} : input;
    if ((input.action === "delivery-poll" || input.action === "execution-poll") && input.binding) {
      const recipeSnapshot = jobSnapshotForProfile(input.binding.profile);
      const binding = {...input.binding,recipeSnapshot,...(execution ? {execute:true} : {})};
      body = {...body,binding,bindingHash:digest(canonicalSnapshot(binding))};
    }
    const { data, error } = await admin.rpc(setup ? 'connect_setup_device' : delivery ? "connect_delivery_action" : "connect_device_action", { p_id: id, p_origin: origin, p_public_key: device.public_key,
      p_nonce: nonce, p_action: execution ? input.action.replace("execution-","delivery-") : input.action, p_input: body });
    if (setup && !error && data && !data.error) return json({version:1,origin,generationEnabled:false,setupProtocol:1,deviceId:id,pollAfterSeconds:data.request?5:60,request:data.request?setupDeviceView.parse(data.request):null});
    return result(data, error);
  } catch (error) { return handleError(error); }
}
export { readBody as readConnectBody, handleError as connectError, json as connectJSON };
