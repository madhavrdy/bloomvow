// Listing strength: what's done and what's missing. Shared by Overview and Edit listing.
export type CheckInput = {
  description: string | null; price_from: number | null; capacity_max: number | null; usesCapacity: boolean;
  phone: string | null; website: string | null; photos: number; packages: { price: number | null }[];
  details?: number;   // number of detail fields answered (amenities, services...)
};
export type Check = { label: string; done: boolean };

export const words = (s: string | null) => (s ?? '').trim().split(/\s+/).filter(Boolean).length;

export function listingChecks(i: CheckInput): Check[] {
  const checks: Check[] = [
    { label: 'Description of 120+ words', done: words(i.description) >= 120 },
    { label: 'Starting price', done: i.price_from != null },
    { label: 'Phone and website', done: Boolean(i.phone && i.website) },
    { label: (i.details ?? 0) >= 5 ? 'Details & amenities' : `Answer ${5 - (i.details ?? 0)} more detail question${5 - (i.details ?? 0) === 1 ? '' : 's'}`, done: (i.details ?? 0) >= 5 },
    { label: i.photos >= 8 ? '8+ photos' : `Add ${8 - i.photos} more photo${8 - i.photos === 1 ? '' : 's'} (8+)`, done: i.photos >= 8 },
    {
      label: i.packages.length === 0 ? 'At least one package' : i.packages.some((p) => p.price == null)
        ? `Add prices to ${i.packages.filter((p) => p.price == null).length} package(s)` : 'Packages with prices',
      done: i.packages.length > 0 && i.packages.every((p) => p.price != null),
    },
  ];
  if (i.usesCapacity) checks.splice(2, 0, { label: 'Guest capacity', done: i.capacity_max != null });
  return checks;
}

export const strength = (c: Check[]) => Math.round((100 * c.filter((x) => x.done).length) / c.length);
