import {describe,expect,it} from "vitest";
import {getSafeAuthRedirectPath} from "./redirect";

describe("Authenticated return destinations",()=>{
  it.each([undefined,null,"","/","/auth/login","/auth/callback?code=example","https://outside.example","//outside.example","/\\outside.example","/\n/outside.example"])("defaults unsafe, empty and login-loop paths to Dashboard: %s",path=>{
    expect(getSafeAuthRedirectPath(path)).toBe("/dashboard");
  });
  it.each(["/dashboard","/dashboard?tab=learn","/generate","/gallery?generation=example","/design/example?page=two","/settings/storage"])("preserves explicit app destinations: %s",path=>{
    expect(getSafeAuthRedirectPath(path)).toBe(path);
  });
});
