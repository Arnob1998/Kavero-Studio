import { randomUUID } from "node:crypto";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";

const api = "https://www.googleapis.com/drive/v3/files";
async function driveFetch(token: string, url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store" });
}
async function boundedBytes(response: Response, max: number) {
  const reader = response.body?.getReader(); if (!reader) throw new Error("local-save-drive-response-invalid");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new Error("local-save-object-conflict"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function reserveLocalDriveIds(token: string) {
  const response = await driveFetch(token, `${api}/generateIds?count=2&space=drive&type=files`);
  if (!response.ok) { await response.body?.cancel(); throw new Error("local-save-drive-unavailable"); }
  const data = JSON.parse((await boundedBytes(response, 8192)).toString("utf8")) as { ids?: unknown };
  if (!Array.isArray(data.ids) || data.ids.length !== 2 || data.ids[0] === data.ids[1]
    || data.ids.some(id => typeof id !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(id))) throw new Error("local-save-drive-response-invalid");
  return data.ids as [string, string];
}
export async function readLocalDriveObject(token: string, ref: StoredObjectRef, jobId: string, sha256: string, expectedSize: number) {
  const id = encodeURIComponent(ref.objectKey);
  const response = await driveFetch(token, `${api}/${id}?fields=id,mimeType,size,parents,trashed,appProperties`);
  if (response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok) { await response.body?.cancel(); throw new Error("local-save-drive-unavailable"); }
  const meta = JSON.parse((await boundedBytes(response, 8192)).toString("utf8"));
  if (meta.id !== ref.objectKey || meta.trashed || meta.mimeType !== ref.metadata?.contentType || Number(meta.size) !== expectedSize
    || !Array.isArray(meta.parents) || meta.parents.length !== 1 || meta.parents[0] !== ref.metadata?.folderId
    || meta.appProperties?.kaveroLocalJob !== jobId || meta.appProperties?.kaveroSHA256 !== sha256) throw new Error("local-save-object-conflict");
  const content = await driveFetch(token, `${api}/${id}?alt=media`);
  if (!content.ok) { await content.body?.cancel(); throw new Error("local-save-drive-unavailable"); }
  const bytes = await boundedBytes(content, expectedSize);
  if (bytes.length !== expectedSize) throw new Error("local-save-object-conflict");
  return bytes;
}
export async function createLocalDriveObject(token: string, ref: StoredObjectRef, jobId: string, sha256: string, bytes: Buffer) {
  let boundary: string;
  do { boundary = `kavero_${randomUUID()}`; } while (bytes.includes(Buffer.from(boundary)));
  const metadata = JSON.stringify({ id: ref.objectKey, name: ref.metadata?.name, mimeType: ref.metadata?.contentType,
    parents: [ref.metadata?.folderId], appProperties: { kaveroLocalJob: jobId, kaveroSHA256: sha256 } });
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${ref.metadata?.contentType}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const response = await driveFetch(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body),
  });
  // 409 is expected for the same reserved ID after a lost create acknowledgement.
  await response.body?.cancel();
  if (!response.ok && response.status !== 409) throw new Error("local-save-drive-unavailable");
}
