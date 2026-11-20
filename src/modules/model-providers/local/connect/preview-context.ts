import { enabled } from './result-service';
import { owner } from './service';

/** Same deployment/origin/account gates as the existing Remote website. */
export async function remotePreviewOwner(request: Request) {
  const clean = new URL(request.url); clean.search = '';
  const origin = enabled(new Request(clean, { method: request.method, headers: request.headers }));
  return { ownerId: await owner(request, origin), origin };
}
