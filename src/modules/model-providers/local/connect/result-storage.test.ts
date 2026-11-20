// @vitest-environment node
import {randomUUID} from "node:crypto";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {ensureResultObject,removeResultObject} from "./result-storage";
import {digest} from "./protocol";
import type {ResultRow} from "./result-contract";
// @ts-expect-error Shared native fixture.
import {pngFixture} from "../../../../../scripts/local-generation/png-fixture.mjs";
const bytes=pngFixture(),owner=randomUUID(),id=randomUUID(),row={object_key:`connect-results/${owner}/${id}/final.png`,descriptor:{sha256:digest(bytes),sizeBytes:bytes.length}} as ResultRow;
const fetchMock=vi.fn();beforeEach(()=>{vi.stubEnv("SUPABASE_INTERNAL_URL","https://storage.example");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","unit-test-only");vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();});afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const missing=()=>new Response(JSON.stringify({statusCode:"404"}),{status:400});
describe("immutable Connect staging objects",()=>{
 it("recovers a storage write whose acknowledgement was lost",async()=>{fetchMock.mockResolvedValueOnce(missing()).mockRejectedValueOnce(Error("lost-write-ack")).mockResolvedValueOnce(new Response(bytes));await ensureResultObject(row,bytes);expect(fetchMock.mock.calls.map(c=>c[1].method??"GET")).toEqual(["GET","POST","GET"]);expect(fetchMock.mock.calls[1][1].headers["x-upsert"]).toBe("false");});
 it("reuses matching committed bytes without another upload",async()=>{fetchMock.mockResolvedValueOnce(new Response(bytes));await ensureResultObject(row,bytes);expect(fetchMock).toHaveBeenCalledOnce();});
 it("never overwrites conflicting retained bytes",async()=>{fetchMock.mockResolvedValueOnce(new Response(pngFixture({filter:1})));await expect(ensureResultObject(row,bytes)).rejects.toThrow("result-object-conflict");expect(fetchMock).toHaveBeenCalledOnce();});
 it("preserves retry identity when storage fails before writing",async()=>{fetchMock.mockResolvedValueOnce(missing()).mockRejectedValueOnce(Error("disconnected")).mockResolvedValueOnce(missing());await expect(ensureResultObject(row,bytes)).rejects.toThrow("result-storage-unconfirmed");expect(fetchMock.mock.calls.filter(c=>c[1].method==="DELETE")).toHaveLength(0);});
 it("confirms cleanup by rereading the fixed key",async()=>{fetchMock.mockResolvedValueOnce(new Response("{}")).mockResolvedValueOnce(missing());await removeResultObject(row);expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({prefixes:[row.object_key]});});
 it("does not claim cleanup when an object remains",async()=>{fetchMock.mockResolvedValueOnce(new Response("{}")).mockResolvedValueOnce(new Response(bytes));await expect(removeResultObject(row)).rejects.toThrow("result-cleanup-unconfirmed");});
});
