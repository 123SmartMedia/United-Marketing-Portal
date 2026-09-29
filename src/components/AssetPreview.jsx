'use client';

import { useState } from 'react';
import { assetUrl } from '@/lib/asset';

/**
 * Large preview panel on the item detail page. Picks a sensible primary file
 * (image → video → pdf) and lets the user flip between multiple previewable
 * files (e.g. Classic / Color-Pop / Illustration styles).
 */
export default function AssetPreview({ item }) {
  const previewable = item.files.filter(
    (f) => f.type === 'image' || f.type === 'video' || f.type === 'pdf'
  );
  const ordered = [
    ...previewable.filter((f) => f.type === 'image'),
    ...previewable.filter((f) => f.type === 'video'),
    ...previewable.filter((f) => f.type === 'pdf'),
  ];
  const [active, setActive] = useState(ordered[0] || null);

  // "Classic", "Color-Pop · Spanish"… so each variant's image has its own alt text.
  const variantName = (f) => [f.style, f.brand, f.lang].filter(Boolean).join(' · ') || f.label;

  if (!active) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-navy-50 text-navy-600">
        Preview unavailable — use the download buttons.
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-navy-100 bg-navy-50">
        {active.type === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(active.url)} alt={ordered.length > 1 ? `${item.title} — ${variantName(active)}` : item.title} className="h-full w-full object-contain" />
        )}
        {active.type === 'video' && (
          <video src={assetUrl(active.url)} controls playsInline className="h-full w-full bg-black">
            Your browser does not support video playback.
          </video>
        )}
        {active.type === 'pdf' && (
          <object data={`${assetUrl(active.url)}#view=FitH`} type="application/pdf" className="h-[520px] w-full">
            <div className="flex h-[520px] flex-col items-center justify-center gap-3 text-navy-600">
              <p>PDF preview isn’t available in this browser.</p>
              <a
                href={assetUrl(active.url)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white"
              >
                Open PDF
              </a>
            </div>
          </object>
        )}
      </div>

      {ordered.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Preview style">
          {ordered.map((f) => (
            <button
              key={f.url}
              type="button"
              aria-pressed={active.url === f.url}
              onClick={() => setActive(f)}
              className={`min-h-11 rounded-lg border px-3 py-1.5 text-xs sm:min-h-9 font-medium transition ${
                active.url === f.url
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-navy-200 text-navy-700 hover:border-brand-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
