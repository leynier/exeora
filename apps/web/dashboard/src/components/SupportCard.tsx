const GITHUB_URL = "https://github.com/leynier/exeora";

/**
 * The one ask the dashboard makes.
 *
 * Exeora is free and open source, and a star is how someone who is happy
 * with it can help other people find it. The CLI already asks once, in the
 * terminal; this card is the same ask for the people who only ever see the
 * dashboard, and it lives on Settings so the screens about the fleet stay
 * about the fleet.
 */
export function SupportCard({ className = "" }: { className?: string }) {
  return (
    <section className={`border-border bg-surface rounded-xl border p-5 ${className}`}>
      <h2 className="text-title-lg">Support the project</h2>
      <p className="text-body-md text-foreground-muted mt-1.5">
        Exeora is free and open source. A star helps other people find it.
      </p>

      <a href={GITHUB_URL} target="_blank" rel="noopener" className="btn mt-4">
        <Star />
        Star on GitHub
      </a>
    </section>
  );
}

function Star() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}
