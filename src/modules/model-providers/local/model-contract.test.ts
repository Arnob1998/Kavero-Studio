import {describe,it,expect} from "vitest";
import {parseLocalModelConfig,parseLocalModelSource} from "./model-contract";
const source={id:"qwen-image-2-1",source:"https://huggingface.co/Abiray/Qwen-Image-2.1-GGUF"};
describe("Local model discovery config",()=>{
  it("supports source-only entries, canonical trailing slashes and independent returned objects",()=>{
    const input={schemaVersion:1,models:[{...source,source:source.source+"/"}]};
    const parsed=parseLocalModelConfig(input);expect(parsed.models).toEqual([source]);
    parsed.models[0].id="changed";expect(input.models[0].id).toBe(source.id);
  });
  it.each(["capabilities","command","runtime","licenses","publicApproved","termsDigest"])("rejects %s overrides from config",key=>{
    expect(()=>parseLocalModelSource({...source,[key]:true})).toThrow();
  });
  it.each([
    "http://huggingface.co/owner/model","https://evil.test/owner/model",
    "https://huggingface.co.evil.test/owner/model","https://user:secret@huggingface.co/owner/model",
    "https://huggingface.co/owner/model?token=secret","https://huggingface.co/owner/model#fragment",
    "https://huggingface.co/owner/model/../other","https://huggingface.co/owner/%2fmodel",
    "https://huggingface.co/owner/model/resolve/main/a.gguf","https://127.0.0.1/owner/model",
  ])("rejects noncanonical/unsupported discovery input %s",url=>{
    expect(()=>parseLocalModelSource({...source,source:url})).toThrow();
  });
  it.each(["../a.gguf","/a.gguf","a\\b.gguf","a//b.gguf","CON.gguf","a/../b.gguf"])("rejects unsafe preferred file %s",preferredFile=>{
    expect(()=>parseLocalModelSource({...source,preferredFile})).toThrow();
  });
  it("rejects duplicates, unsupported schema versions and top-level settings",()=>{
    expect(()=>parseLocalModelConfig({schemaVersion:1,models:[source,source]})).toThrow("duplicate-model-id");
    expect(()=>parseLocalModelConfig({schemaVersion:2,models:[]})).toThrow();
    expect(()=>parseLocalModelConfig({schemaVersion:1,models:[],command:"run"})).toThrow();
    expect(()=>parseLocalModelConfig({schemaVersion:1,models:Array.from({length:101},(_,i)=>({...source,id:`model-${i}`}))})).toThrow();
  });
});
