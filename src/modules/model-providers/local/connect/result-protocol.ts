// Dependency-free wire domain shared with the pinned native companion.
export const RESULT_CONTROL="/api/connect/results";
export const RESULT_UPLOAD="/api/connect/results/upload";
export function resultProof(origin:string,path:string,device:string,time:string,nonce:string,metadata:string,sha256:string){
 return ["kavero-connect-result-v1",origin,"POST",path,device,time,nonce,metadata,sha256].join("\n");
}
