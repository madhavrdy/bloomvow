// Shrinks photos in the browser before upload (longest side 1600px, WebP ~80%),
// so a 6 MB phone photo becomes ~150-300 KB. Keeps Supabase's free 1 GB storage
// and 5 GB monthly downloads going much further, and pages load faster.
export const MAX_ORIGINAL = 25 * 1024 * 1024;

export async function shrinkImage(file: File, maxSide = 1600, quality = 0.8): Promise<File> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions); }
  catch { return file; }                       // unknown format: upload as is (size limits still apply)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const toBlob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, quality));
  let blob = await toBlob('image/webp');
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg');   // older Safari can't encode WebP
  if (!blob || (scale === 1 && blob.size >= file.size)) return file;           // already small: keep the original
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.' + ext, { type: blob.type });
}
export const extOf = (f: File) => f.type.split('/')[1].replace('jpeg', 'jpg');
