import {readFileSync} from 'node:fs';import {sha} from './install/manifest.mjs';
export const Q4_FINGERPRINT='d9cd1dc7cc93a20c2ffc8cc780393a04cfc6043a5560ddf12f2924c3ea575f07';
export const Q3_FINGERPRINT='c058d31ce26726e7a1a746b05a1f446594e96f68ca564ee34735ec3e07db48ee';
// Host-owned executable identities. No discovery/config fields can extend this.
export function nativeProfile(fingerprint=Q4_FINGERPRINT){
 const q3=fingerprint===Q3_FINGERPRINT;if(!q3&&fingerprint!==Q4_FINGERPRINT)throw Error('unsupported-native-profile');
 const bytes=readFileSync(new URL(q3?'./install/qwen-q3-recipe.json':'./install/qwen-recipe.json',import.meta.url));
 const expected=q3?'511a8ae8e7319925baa425a2a12ac056cdfd030842796040849e232729427825':'a1a8dca181f17f960657f6d606510287ea8199368c9c1294ae4f2cebf5862c9f';
 if(sha(bytes)!==expected)throw Error('native-profile-changed');
 const recipe=JSON.parse(bytes);return {fingerprint,recipe,metadata:{path:'evidence/package-manifest.json',bytes:bytes.length,sha256:expected},
  diffusion:q3?'downloads/qwen_image_2.1_Q3_K_M.gguf':'downloads/qwen_image_2.1_Q4_K_M.gguf'};
}
