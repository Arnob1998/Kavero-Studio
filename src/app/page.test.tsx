import {beforeEach,describe,expect,it,vi} from "vitest";
import {render,screen} from "@testing-library/react";
const mocks=vi.hoisted(()=>({redirect:vi.fn((url:string)=>{throw new Error("redirect:"+url);})}));
vi.mock("next/navigation",()=>({redirect:mocks.redirect}));
vi.mock("@/components/site-nav",()=>({SiteNav:()=>null}));
vi.mock("next/image",()=>({default:()=>null}));
import HomePage from "./page";
import DashboardPage from "./dashboard/page";

beforeEach(()=>vi.clearAllMocks());
describe("Public Home and migrated Dashboard",()=>{
  it("offers the real workspace and source without auth-dependent homepage content",async()=>{
    render(await HomePage());
    expect(screen.getByRole("heading",{level:1})).toHaveTextContent("Design with AI. Keep control of your work.");
    expect(screen.getAllByRole("link",{name:/Start designing free/})[0]).toHaveAttribute("href","/dashboard");
    expect(screen.getByRole("link",{name:"View GitHub"})).toHaveAttribute("href","https://github.com/Arnob1998/Kavero-Studio");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it.each(["apps","learn"])("preserves a legacy root tab bookmark: %s",async tab=>{
    await expect(HomePage({searchParams:Promise.resolve({tab})})).rejects.toThrow("redirect:/dashboard?tab="+tab);
  });
  it("preserves both launcher tab destinations at their new route",async()=>{
    render(await DashboardPage({searchParams:Promise.resolve({})}));
    expect(screen.getByRole("link",{name:"Apps"})).toHaveAttribute("href","/dashboard");
    expect(screen.getByRole("link",{name:"Learn"})).toHaveAttribute("href","/dashboard?tab=learn");
    expect(screen.getAllByRole("link",{name:/Generate Images/})).not.toHaveLength(0);
    expect(screen.getByRole("link",{name:/Compose Images/})).toHaveAttribute("href","/canvas");
    expect(screen.getByRole("link",{name:/Edit Images/})).toHaveAttribute("href","/canvas");
    expect(screen.getByRole("link",{name:/Upscale & Enhance/})).toHaveAttribute("href","/canvas");
  });
  it("retains the Learn content after migration",async()=>{
    render(await DashboardPage({searchParams:Promise.resolve({tab:"learn"})}));
    expect(screen.getByRole("heading",{name:"Privacy & Security"})).toBeInTheDocument();
  });
});

