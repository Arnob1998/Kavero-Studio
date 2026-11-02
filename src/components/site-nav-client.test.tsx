import {beforeEach,expect,it,vi} from "vitest";
import {render,screen,waitFor,within} from "@testing-library/react";
const mocks=vi.hoisted(()=>({getUser:vi.fn(),subscribe:vi.fn(()=>({data:{subscription:{unsubscribe:vi.fn()}}}))}));
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({auth:{getUser:mocks.getUser,onAuthStateChange:mocks.subscribe}})}));
import {SiteNavClient} from "./site-nav-client";
beforeEach(()=>{vi.clearAllMocks();mocks.getUser.mockResolvedValue({data:{user:null}});});
it("takes anonymous homepage visitors to the Dashboard sign-in flow",async()=>{
  render(<SiteNavClient activeLabel="Home" variant="landing"/>);
  expect(screen.getByRole("link",{name:/Get started/})).toHaveAttribute("href","/auth/login?next=%2Fdashboard");
  await waitFor(()=>expect(mocks.getUser).toHaveBeenCalled());
});
it("offers a direct Dashboard entry to a signed-in visitor",async()=>{
  mocks.getUser.mockResolvedValue({data:{user:{id:"example",email:"example@example.local",user_metadata:{}}}});
  render(<SiteNavClient activeLabel="Home" variant="landing"/>);
  expect(await screen.findByRole("link",{name:/Open dashboard/})).toHaveAttribute("href","/dashboard");
});
it("offers only source and app entry in the simplified homepage navigation",async()=>{
  render(<SiteNavClient activeLabel="Home" variant="landing"/>);
  const nav=screen.getByRole("navigation",{name:"Homepage navigation"});
  expect(within(nav).getAllByRole("link")).toHaveLength(2);
  expect(within(nav).getByRole("link",{name:"Kavero source on GitHub"})).toHaveAttribute("href","https://github.com/Arnob1998/Kavero-Studio");
  expect(screen.queryByRole("link",{name:"Workspace"})).not.toBeInTheDocument();
  await waitFor(()=>expect(mocks.getUser).toHaveBeenCalled());
});
