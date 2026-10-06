"use client";

export function LogoMark({
  size = 32,
}: {
  size?: number;
  animated?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="RAGX logo"
    >
      <rect x="1" y="1" width="30" height="30" rx="8.5" fill="#1D1D1F" />
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" stroke="white" strokeOpacity="0.09" />
      <rect x="8" y="9" width="10" height="3" rx="1.5" fill="white" opacity="0.35" />
      <rect x="8" y="14.5" width="16" height="3" rx="1.5" fill="#0071E3" />
      <rect x="8" y="20" width="10" height="3" rx="1.5" fill="white" opacity="0.35" />
    </svg>
  );
}

export function Logo({
  size = 32,
  className = "",
  wordmark = true,
}: {
  size?: number;
  className?: string;
  wordmark?: boolean;
  animated?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} />
      {wordmark && (
        <span className="text-[18px] font-semibold tracking-[-0.04em] text-[#1D1D1F]">
          RAGX
        </span>
      )}
    </span>
  );
}
