/**
 * United Mortgage wordmark, recreated as inline SVG so it stays crisp and can be
 * recolored (navy on light headers, white in the footer). Matches the
 * "UNITED / MORTGAGE CORP" lockup from the current collateral.
 */
export default function Logo({ variant = 'navy', className = '' }) {
  const primary = variant === 'white' ? '#ffffff' : 'var(--color-navy-900)';
  const secondary = variant === 'white' ? 'rgba(255,255,255,0.75)' : 'var(--color-brand-500)';
  return (
    <span className={`inline-flex flex-col leading-none ${className}`} aria-label="United Mortgage">
      <span
        className="font-extrabold tracking-tight"
        style={{ color: primary, fontSize: '1.4em', letterSpacing: '0.02em' }}
      >
        UNITED
      </span>
      <span
        className="font-semibold"
        style={{ color: secondary, fontSize: '0.62em', letterSpacing: '0.32em' }}
      >
        MORTGAGE&nbsp;CORP
      </span>
    </span>
  );
}
