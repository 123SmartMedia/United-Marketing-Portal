/**
 * Renders an item's downloadable files as one-click download buttons — matching
 * the current site's no-login, direct-download behavior. `download` attribute +
 * the immutable cache header on /assets means clicks pull the file straight down.
 */
import { assetUrl } from '@/lib/asset';

// 44px tall on touch screens, a little tighter on desktop.
const BUTTON = 'inline-flex min-h-11 items-center rounded-lg px-3 text-xs sm:min-h-9';

export default function DownloadList({ files }) {
  return (
    <ul className="divide-y divide-navy-100 overflow-hidden rounded-xl border border-navy-100">
      {files.map((f) => {
        // Many files are labelled just "Download"; the filename says which one.
        const what = f.label && f.label !== 'Download' ? f.label : f.name;
        return (
          <li key={f.url} className="flex flex-wrap items-center gap-3 bg-white px-4 py-3 hover:bg-navy-50">
            <TypeChip type={f.type} ext={f.ext} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-navy-800">{f.label}</p>
              <p className="truncate text-xs text-navy-600">{f.name}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {(f.type === 'pdf' || f.type === 'image' || f.type === 'video') && (
                <a
                  href={assetUrl(f.url)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Preview ${what} (opens in new tab)`}
                  className={`${BUTTON} border border-navy-200 font-medium text-navy-700 transition hover:border-brand-400 hover:text-brand-600`}
                >
                  Preview
                </a>
              )}
              <a
                href={assetUrl(f.url)}
                download={f.name}
                aria-label={`Download ${what}`}
                className={`${BUTTON} bg-brand-600 font-semibold text-white transition hover:bg-brand-700`}
              >
                Download
              </a>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TypeChip({ type, ext }) {
  const map = {
    pdf: 'bg-red-50 text-red-700',
    video: 'bg-brand-50 text-brand-700',
    image: 'bg-emerald-50 text-emerald-700',
    doc: 'bg-navy-100 text-navy-700',
    file: 'bg-navy-100 text-navy-700',
  };
  return (
    <span
      aria-hidden="true"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold uppercase ${map[type] || map.file}`}
    >
      {ext}
    </span>
  );
}
