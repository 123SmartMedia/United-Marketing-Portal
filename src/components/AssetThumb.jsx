/**
 * Renders a preview for a catalog item. Uses the item's thumbnail image when
 * available; otherwise falls back to a typed placeholder (video / PDF / file)
 * so PDF-only and video-only items still read clearly in a grid.
 */
export default function AssetThumb({ item, className = '', rounded = 'rounded-xl' }) {
  const isVideo = !item.thumbnail && item.types?.includes('video');
  const isPdf = !item.thumbnail && item.types?.includes('pdf');

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-navy-50 ${rounded} ${className}`}
    >
      {item.thumbnail ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.thumbnail}
            alt={item.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
          {item.types?.includes('video') && <PlayBadge />}
        </>
      ) : isVideo ? (
        <Placeholder label="Video" glyph={<PlayGlyph />} tone="brand" />
      ) : isPdf ? (
        <Placeholder label="PDF" glyph={<DocGlyph />} tone="navy" />
      ) : (
        <Placeholder label="Asset" glyph={<DocGlyph />} tone="navy" />
      )}
    </div>
  );
}

function Placeholder({ label, glyph, tone }) {
  const bg = tone === 'brand' ? 'from-brand-500 to-navy-700' : 'from-navy-600 to-navy-800';
  return (
    <div className={`flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br ${bg} text-white`}>
      {glyph}
      <span className="text-xs font-semibold uppercase tracking-wider opacity-90">{label}</span>
    </div>
  );
}

function PlayBadge() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
        <PlayGlyph />
      </span>
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="white" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function DocGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 2h9l5 5v15a0 0 0 0 1 0 0H6a0 0 0 0 1 0 0V2z" stroke="white" strokeWidth="1.5" />
      <path d="M14 2v6h6" stroke="white" strokeWidth="1.5" />
    </svg>
  );
}
