export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo">
      <defs>
        <linearGradient id="lg-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7b7bf5" />
          <stop offset="1" stopColor="#4646c8" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#lg-bg)" />
      <path d="M20 14h17l9 9v27a3 3 0 0 1-3 3H20a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z" fill="#fff" opacity="0.95" />
      <path d="M37 14v7a2 2 0 0 0 2 2h7" fill="none" stroke="#c9c9fb" strokeWidth="2" />
      <rect x="22" y="29" width="14" height="3.4" rx="1.7" fill="#5b5bd6" />
      <rect x="22" y="36" width="19" height="3.4" rx="1.7" fill="#c9c9fb" />
      <rect x="22" y="43" width="11" height="3.4" rx="1.7" fill="#c9c9fb" />
      <path d="M43 36.5l2.2 4.6 4.8.6-3.5 3.3.9 4.8-4.4-2.4-4.3 2.4.9-4.8-3.5-3.3 4.8-.6z" fill="#ffb224" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
