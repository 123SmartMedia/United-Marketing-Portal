/**
 * Renders an item's downloadable files as one-click download buttons — matching
 * the current site's no-login, direct-download behavior. `download` attribute +
 * the immutable cache header on /assets means clicks pull the file straight down.
 */
import { assetUrl } from '@/lib/asset';

export default function DownloadList({ files }) {
  return (
    <ul className="divide-y divide-navy-100 overflow-hidden rounded-xl border border-navy-100">
      {files.map((f) => (
        <li key={f.url} className="flex items-center gap-3 bg-white px-4 py-3 hover:bg-navy-50">
          <TypeChip type={f.type} ext={f.ext} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-navy-800">{f.label}</p>
            <p className="truncate text-xs text-navy-400">{f.name}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {(f.type === 'pdf' || f.type === 'image' || f.type === 'video') && (
              <a
                href={assetUrl(f.url)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-600 transition hover:border-brand-400 hover:text-brand-600"
              >
                Preview
              </a>
            )}
            <a
              href={assetUrl(f.url)}
              download={f.name}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600"
            >
              Download
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TypeChip({ type, ext }) {
  const map = {
    pdf: 'bg-red-50 text-red-600',
    video: 'bg-brand-50 text-brand-600',
    image: 'bg-emerald-50 text-emerald-600',
    doc: 'bg-navy-100 text-navy-600',
    file: 'bg-navy-100 text-navy-600',
  };
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold uppercase ${map[type] || map.file}`}
    >
      {ext}
    </span>
  );
}
