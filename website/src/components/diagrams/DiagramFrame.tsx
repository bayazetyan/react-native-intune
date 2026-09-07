import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Frame for the ported artboards.
 *
 * The artboards are fixed-width mocks — 1200px, as their own labels state — and a
 * documentation column is around 900px. The first version scrolled, which meant the
 * diagram that explains the page was half off-screen until the reader thought to drag it.
 * This scales instead: the artboard keeps its declared geometry and is shrunk to whatever
 * width is actually available.
 *
 * Measured rather than computed in CSS because it cannot be done in CSS. Dividing one
 * length by another is not permitted in `calc()`, so `scale(100cqw / 1200px)` is invalid,
 * and `zoom` reflows the artboard's own grid instead of scaling it. A ResizeObserver plus
 * a transform is the version that keeps the layout intact.
 *
 * Scale is capped at 1: a 1200px artboard blown up to fill a wider screen would be a
 * blurry diagram with 18px body text.
 */
export function DiagramFrame({
  caption,
  children,
}: {
  caption?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  const measure = useCallback(() => {
    const available = outer.current?.clientWidth;
    const natural = inner.current?.firstElementChild as HTMLElement | null;
    if (!available || !natural) {
      return;
    }
    const width = natural.offsetWidth;
    const next = width > 0 ? Math.min(1, available / width) : 1;
    setScale(next);
    // The transform does not affect layout, so the wrapper has to be told how tall the
    // scaled artboard actually is or the page keeps a gap the size of the unscaled one.
    setHeight(natural.offsetHeight * next);
  }, []);

  useEffect(() => {
    measure();
    const target = outer.current;
    if (!target || typeof ResizeObserver === 'undefined') {
      return;
    }
    const ro = new ResizeObserver(measure);
    ro.observe(target);
    // The artboards use webfonts, and a diagram measured before IBM Plex arrives is
    // measured at fallback metrics — which is a visibly wrong height on first paint.
    void document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <figure className="rni-diagram">
      <div className="rni-diagram__fit" ref={outer} style={{ height }}>
        <div
          ref={inner}
          className="rni-diagram__scaled"
          style={{ transform: `scale(${scale})` }}
        >
          {children}
        </div>
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
