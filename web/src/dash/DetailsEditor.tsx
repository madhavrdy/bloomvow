// Edit structured vendor details (amenities, services, styles...) for one category.
// Used by vendors after claiming (Edit listing) and by admins (Vendors > Edit).
import { useState } from 'preact/hooks';
import { groupsFor, type Details, type DetailField } from '../lib/details';

export function DetailsEditor({ category, value, onChange, compact = false }: {
  category: string; value: Details; onChange: (d: Details) => void; compact?: boolean;
}) {
  const groups = groupsFor(category);
  const [open, setOpen] = useState<number | null>(compact ? null : 0);

  const set = (key: string, v: Details[string] | null) => {
    const next = { ...value };
    if (v == null || (Array.isArray(v) && v.length === 0) || v === '') delete next[key];
    else next[key] = v;
    onChange(next);
  };
  const toggle = (f: DetailField, opt: string) => {
    if (f.type !== 'multi') return;
    const cur = Array.isArray(value[f.key]) ? (value[f.key] as string[]) : [];
    const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : f.options.filter((o) => o === opt || cur.includes(o));
    set(f.key, next);
  };
  const filled = (fields: DetailField[]) => fields.filter((f) => value[f.key] != null).length;

  return (
    <div class="details-ed">
      {groups.map((g, gi) => (
        <section class={compact ? 'det-group' : 'panel'} key={g.title}>
          <button type="button" class="det-head" aria-expanded={open === gi} onClick={() => setOpen(open === gi ? null : gi)}>
            <h2 style={compact ? 'font-size:15px' : ''}>{g.title}</h2>
            <span class="muted" style="font-size:13px">{filled(g.fields)} of {g.fields.length} answered {open === gi ? '▴' : '▾'}</span>
          </button>
          {open === gi && g.fields.map((f) => (
            <div class="det-field" key={f.key}>
              <span class="det-label">{f.label}{f.type === 'multi' && Array.isArray(value[f.key]) ? ` (${(value[f.key] as string[]).length})` : ''}</span>
              {f.help && <span class="muted" style="font-size:12px">{f.help}</span>}
              {f.type === 'multi' && (
                <div class="seg" role="group" aria-label={f.label}>
                  {f.options.map((o) => (
                    <button type="button" aria-pressed={Array.isArray(value[f.key]) && (value[f.key] as string[]).includes(o)} onClick={() => toggle(f, o)}>{o}</button>
                  ))}
                </div>
              )}
              {f.type === 'single' && (
                <div class="seg" role="radiogroup" aria-label={f.label}>
                  {f.options.map((o) => (
                    <button type="button" role="radio" aria-checked={value[f.key] === o} aria-pressed={value[f.key] === o}
                      onClick={() => set(f.key, value[f.key] === o ? null : o)}>{o}</button>
                  ))}
                </div>
              )}
              {f.type === 'number' && (
                <label class="field" style="max-width:240px"><span class="sr-only">{f.label}</span>
                  <span style="display:flex;align-items:center;gap:8px">
                    {f.unit === '$' && <b>$</b>}
                    <input inputMode="numeric" value={value[f.key] != null ? String(value[f.key]) : ''} aria-label={f.label}
                      onInput={(e) => {
                        const raw = e.currentTarget.value.replace(/[^\d]/g, '');
                        const n = raw ? Math.min(Number(raw), f.max ?? 1_000_000) : null;
                        set(f.key, n && n > 0 ? n : null);
                      }} />
                    {f.unit && f.unit !== '$' && <span class="muted">{f.unit}</span>}
                  </span>
                </label>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
