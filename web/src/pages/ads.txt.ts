import { getData } from '../lib/data';
import { adsTxt } from '../lib/ads';

// /ads.txt: authorised sellers (Google AdSense plus any partners from Admin > Ads).
export async function GET() {
  const d = await getData();
  return new Response(adsTxt(d.ads), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
