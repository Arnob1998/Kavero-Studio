import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {localProfiles,localImageLimits} from '@/modules/model-providers/local/browser-profiles';
vi.mock('@/components/site-nav',()=>({SiteNav:()=> <nav>Navigation</nav>}));
vi.mock('@/modules/model-providers/browser-settings',()=>({useModelProviderSettings:()=>({settings:{catalog:[],selected:{imageGenerationModelAlias:'',chatOrchestrationModelAlias:''}},activeModels:()=>[],refresh:vi.fn(),saveSelection:vi.fn()})}));
import {GeneratePage} from './generate-page';
const owner='110fce0e-22ba-4a44-a68a-6619b477ca1b',id='44697489-d22b-432b-818b-155f201cc52d',profile=localProfiles[0];
const fetcher=vi.fn();
beforeEach(()=>{
 sessionStorage.clear();localStorage.clear();sessionStorage.setItem('kavero-local-source','local');
 vi.stubGlobal('fetch',fetcher);
 fetcher.mockImplementation(async(url:string,options:RequestInit={})=>{
  if(url.includes('/setup?')){
   const p=url.includes('q3')?localProfiles[1]:profile;
   return Response.json({ownerId:owner,setup:{packageId:url.includes('q3')?'qwen-2-1-q3-research-delivery-v1':'qwen-2-1-research-delivery-v1',manifest:p.manifest,termsDigest:'b'.repeat(64),consentToken:'1760000000000.'+'c'.repeat(64),purpose:'research-evaluation',accepted:true,available:true,supported:true,installed:!url.includes('q3'),ready:!url.includes('q3'),freeBytes:100*1024**3,downloadBytes:1024**3,workBytes:2*1024**3,requiredFreeBytes:3*1024**3,operation:null}});
  }
  if(url.endsWith('/readiness'))return Response.json({ownerId:owner,ready:true,model:{...profile,...localImageLimits},saveAvailable:true,saveDestination:'This computer'});
  if(url.endsWith('/jobs')&&options.method==='POST')return Response.json({job:{id,state:'generated-unvalidated',createdAt:'2026-11-11T00:00:00Z',output:{state:'generated',expiresAt:'2099-01-01T00:00:00Z'}}},{status:202});
  if(url.endsWith('/save'))return Response.json({save:{state:'unsaved'}});
  return Response.json({authenticated:true,prompts:[],templates:[],storageProvider:'kavero-managed'});
 });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
it('shows memory requirements while queued and changes to generating only after the job starts',async()=>{
 const normal=fetcher.getMockImplementation()!;let state='queued';
 fetcher.mockImplementation(async(url:string,options:RequestInit={})=>{
  if(url.endsWith('/readiness'))return Response.json({ownerId:owner,ready:true,model:{...profile,...localImageLimits},saveAvailable:true,saveDestination:'This computer',hardware:{freeVramMiB:7956,freeRamBytes:4.7*1024**3}});
  if(url.endsWith('/jobs')&&options.method==='POST'||url.endsWith(`/jobs/${id}`))return Response.json({job:{id,state,createdAt:'2026-11-11T00:00:00Z'}});
  return normal(url,options);
 });
 render(<GeneratePage localEnabled/>);await screen.findByRole('button',{name:/Image model: Qwen Image/});
 fireEvent.change(screen.getByRole('textbox',{name:'Prompt'}),{target:{value:'A vase'}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Generate'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Generate'}));
 await waitFor(()=>expect(screen.getAllByText('Waiting for system memory · 4.7 GB available; 8 GB required.')).toHaveLength(2));
 expect(screen.queryByText('Generating on your GPU.')).toBeNull();
 state='running';
 await waitFor(()=>expect(screen.getAllByText('Generating on your GPU.')).toHaveLength(2),{timeout:6500});
 expect(screen.queryByText(/Waiting for system memory/)).toBeNull();
 expect(fetcher.mock.calls.filter(([url,options])=>url.endsWith('/jobs')&&options?.method==='POST')).toHaveLength(1);
},10000);
it('keeps the common Generate composer/results, displays Qwen branding, and excludes undownloaded Q3',async()=>{
 render(<GeneratePage localEnabled/>);
 const picker=await screen.findByRole('button',{name:/Image model: Qwen Image/});
 expect(screen.getByRole('heading',{name:'Kavero'})).toBeInTheDocument();
 expect(screen.queryByRole('heading',{name:'Create on your machine.'})).toBeNull();
 expect(screen.getByRole('button',{name:'Generate'})).toBeDisabled();
 expect(picker.querySelector('img')).toHaveAttribute('src',expect.stringContaining('qwen.svg'));
 fireEvent.pointerDown(picker,{button:0});
 expect(await screen.findByRole('menuitemradio',{name:/Qwen Image.*Q4/})).toBeVisible();
 expect(screen.queryByRole('menuitemradio',{name:/Qwen Image.*Q3/})).toBeNull();
 fireEvent.keyDown(screen.getByRole('menu'),{key:'Escape'});
 fireEvent.change(screen.getByRole('textbox',{name:'Prompt'}),{target:{value:'A glass vase'}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Generate'})).toBeEnabled());
 fireEvent.click(screen.getByRole('button',{name:'Generate'}));
 await screen.findByRole('button',{name:'Save to Gallery'});
 expect(screen.getByRole('link',{name:'Download generated image 1'})).toHaveAttribute('href',`/api/local-generation/jobs/${id}/output`);
 expect(screen.queryByRole('button',{name:/Image model:/})).toBeNull();
 expect(screen.queryByText(/This request keeps its model/)).toBeNull();
 const posts=fetcher.mock.calls.filter(([,options])=>options?.method==='POST');
 expect(posts).toHaveLength(1);expect(posts[0][0]).toBe('/api/local-generation/jobs');
 expect(JSON.parse(posts[0][1].body).intent).toMatchObject({profile:profile.profile,width:512,height:512,count:1,prompt:'A glass vase'});
});
it('keeps cancellation and Create another in the shared results workspace without stranding the composer',async()=>{
 const normal=fetcher.getMockImplementation()!;
 fetcher.mockImplementation(async(url:string,options:RequestInit={})=>{
  if(url.endsWith('/jobs')&&options.method==='POST')return Response.json({job:{id,state:'queued',createdAt:'2026-11-11T00:00:00Z'}},{status:202});
  if(url.endsWith(`/jobs/${id}`)&&options.method==='DELETE')return Response.json({job:{id,state:'cancelled',createdAt:'2026-11-11T00:00:00Z'}});
  return normal(url,options);
 });
 render(<GeneratePage localEnabled/>);await screen.findByRole('button',{name:/Image model: Qwen Image/});
 fireEvent.change(screen.getByRole('textbox',{name:'Prompt'}),{target:{value:'A vase'}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Generate'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Generate'}));
 const cancel=await screen.findByRole('button',{name:'Cancel generation'});
 expect(screen.queryByRole('button',{name:/Image model:/})).toBeNull();
 fireEvent.click(cancel);
 fireEvent.click(await screen.findByRole('button',{name:'Create another'}));
 await screen.findByRole('textbox',{name:'Prompt'});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Generate'})).toBeEnabled());
 expect(sessionStorage.getItem(`kavero-local-job:${owner}`)).toBeNull();
 expect(await screen.findByRole('button',{name:/Image model: Qwen Image/})).toBeEnabled();
});
it('keeps local output downloadable after a save failure and retries saving without generating again',async()=>{
 const normal=fetcher.getMockImplementation()!;let saves=0;
 fetcher.mockImplementation(async(url:string,options:RequestInit={})=>{
  if(url.endsWith('/save')&&options.method==='POST')return ++saves===1?Response.json({error:'Storage disconnected',save:{state:'save-failed'}},{status:503}):Response.json({save:{state:'saved',imageId:id}});
  return normal(url,options);
 });
 render(<GeneratePage localEnabled/>);await screen.findByRole('button',{name:/Image model: Qwen Image/});
 fireEvent.change(screen.getByRole('textbox',{name:'Prompt'}),{target:{value:'A vase'}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Generate'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Generate'}));
 fireEvent.click(await screen.findByRole('button',{name:'Save to Gallery'}));
 const retry=await screen.findByRole('button',{name:'Retry save'});
 expect(screen.getByRole('link',{name:'Download generated image 1'})).toHaveAttribute('href',`/api/local-generation/jobs/${id}/output`);
 fireEvent.click(retry);await screen.findByRole('link',{name:'Open Gallery'});
 expect(screen.getByRole('link',{name:'Download generated image 1'})).toHaveAttribute('href',`/api/gallery/images/${id}/content`);
 expect(fetcher.mock.calls.filter(([url,options])=>url.endsWith('/jobs')&&options?.method==='POST')).toHaveLength(1);
 expect(saves).toBe(2);
});
it('recovers a lost local submission acknowledgement through the common workspace with the same intent',async()=>{
 const normal=fetcher.getMockImplementation()!;let submissions=0;
 fetcher.mockImplementation(async(url:string,options:RequestInit={})=>{
  if(url.endsWith('/jobs')&&options.method==='POST'&&++submissions===1)throw Error('Acknowledgement lost');
  return normal(url,options);
 });
 render(<GeneratePage localEnabled/>);await screen.findByRole('button',{name:/Image model: Qwen Image/});
 fireEvent.change(screen.getByRole('textbox',{name:'Prompt'}),{target:{value:'A vase'}});
 await waitFor(()=>expect(screen.getByRole('button',{name:'Generate'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Generate'}));
 fireEvent.click(await screen.findByRole('button',{name:'Check submission'}));await screen.findByRole('button',{name:'Save to Gallery'});
 const posts=fetcher.mock.calls.filter(([url,options])=>url.endsWith('/jobs')&&options?.method==='POST');
 expect(posts).toHaveLength(2);expect(posts[0][1].body).toBe(posts[1][1].body);
});
