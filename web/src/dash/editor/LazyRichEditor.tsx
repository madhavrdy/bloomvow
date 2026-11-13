// Loads the rich text editor (TipTap, the largest part of the admin) only when a post is opened,
// so the rest of the dashboard opens quickly.
import { useEffect, useState } from 'preact/hooks';
import type { ComponentProps, FunctionComponent } from 'preact';
import type { RichEditor as RE } from './RichEditor';

type Props = ComponentProps<typeof RE>;
let cached: FunctionComponent<Props> | null = null;

export function RichEditor(props: Props) {
  const [Comp, setComp] = useState<FunctionComponent<Props> | null>(() => cached);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (Comp) return;
    import('./RichEditor').then((m) => { cached = m.RichEditor; setComp(() => m.RichEditor); }).catch(() => setFailed(true));
  }, []);
  if (failed) return <p class="form-error">The editor couldn't load. Check your connection and reload the page.</p>;
  if (!Comp) return <div class="rte-loading" style="min-height:420px;border:1px solid #e6e1ea;border-radius:12px;padding:16px;color:#8a8494">Loading editor…</div>;
  return <Comp {...props} />;
}
