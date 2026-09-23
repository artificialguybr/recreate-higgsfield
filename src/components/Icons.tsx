import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (p: P) => {
  const { size = 16, ...rest } = p;
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...rest,
  };
};

export const Spark = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4L12 2z" />
  </svg>
);
export const Plus = (p: P) => <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>;
export const ArrowUp = (p: P) => <svg {...base(p)}><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
export const ImageIc = (p: P) => <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="M21 15l-5-5L5 21" /></svg>;
export const VideoIc = (p: P) => <svg {...base(p)}><rect x="2" y="5" width="14" height="14" rx="3" /><path d="M22 8l-6 4 6 4V8z" /></svg>;
export const Music = (p: P) => <svg {...base(p)}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>;
export const Cube = (p: P) => <svg {...base(p)}><path d="M21 16V8l-9-5-9 5v8l9 5 9-5z" /><path d="M3.3 7.3L12 12l8.7-4.7M12 22V12" /></svg>;
export const Film = (p: P) => <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" /></svg>;
export const Clock = (p: P) => <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
export const Check = (p: P) => <svg {...base(p)}><path d="M5 13l4 4L19 7" /></svg>;
export const Ratio = (p: P) => <svg {...base(p)}><rect x="3" y="6" width="18" height="12" rx="2" /></svg>;
export const Monitor = (p: P) => <svg {...base(p)}><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
export const Play = (p: P) => <svg {...base(p)} fill="currentColor" stroke="none"><path d="M8 5v14l11-7L8 5z" /></svg>;
export const Pause = (p: P) => <svg {...base(p)} fill="currentColor" stroke="none"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>;
export const Scissors = (p: P) => <svg {...base(p)}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M8.5 7.5L20 18M8.5 16.5L20 6" /></svg>;
export const Trash = (p: P) => <svg {...base(p)}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>;
export const ArrowLeft = (p: P) => <svg {...base(p)}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
export const ArrowRight = (p: P) => <svg {...base(p)}><path d="M5 12h14M12 5l7 7-7 7" /></svg>;
export const Minus = (p: P) => <svg {...base(p)}><path d="M5 12h14" /></svg>;
export const Volume = (p: P) => <svg {...base(p)}><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7" /></svg>;
export const VolumeX = (p: P) => <svg {...base(p)}><path d="M11 5L6 9H3v6h3l5 4V5z" /><path d="M16 9l5 6M21 9l-5 6" /></svg>;
export const StepBack = (p: P) => <svg {...base(p)}><path d="M7 5v14M18 5l-9 7 9 7V5z" /></svg>;
export const StepFwd = (p: P) => <svg {...base(p)}><path d="M17 5v14M6 5l9 7-9 7V5z" /></svg>;
export const Camera = (p: P) => <svg {...base(p)}><path d="M4 8h3l2-3h6l2 3h3v11H4V8z" /><circle cx="12" cy="13" r="3.5" /></svg>;
export const X = (p: P) => <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const Chat = (p: P) => <svg {...base(p)}><path d="M4 5h16v11H9l-5 4V5z" /></svg>;
