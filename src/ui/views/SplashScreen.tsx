import { useEffect, useLayoutEffect, useRef } from 'react';
import './splash-screen.scss';

const arches = [
  'M55 310V202C55 137 110 79 160 49Q180 36 200 49C250 79 305 137 305 202V310',
  'M266 310V211C266 165 227 119 194 101Q180 93 166 101C133 119 94 165 94 211V310',
  'M132 305V220C132 193 151 164 172 153Q180 148 188 153C209 164 228 193 228 220V305',
];
const duration = 2600;

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const surface = useRef<HTMLButtonElement>(null);
  const mark = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const svg = mark.current;
    if (!svg || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bounds = svg.getBoundingClientRect();
    const scale = bounds.width / 360;
    const left = -bounds.left / scale - 80;
    const right = (window.innerWidth - bounds.left) / scale + 80;
    const bottom = (window.innerHeight - bounds.top) / scale + 80;
    const top = -bounds.top / scale - 80;
    // Each extended path is a continuous track. One arch-length dash travels
    // along it, pauses exactly over the logo, then follows its tail offscreen.
    const entries = [
      `M${left} 390H55V310`,
      `M${right} 430H266V310`,
      `M40 ${bottom}V470H132V305`,
    ];
    const exits = [
      `V390H${right}`,
      `V430H${left}`,
      `V470H440V${top}`,
    ];
    const animations = Array.from(svg.querySelectorAll<SVGPathElement>('path')).map((path, index) => {
      path.setAttribute('d', arches[index]);
      const length = path.getTotalLength();
      path.setAttribute('d', entries[index]);
      const entryLength = path.getTotalLength();
      path.setAttribute('d', entries[index] + arches[index].replace(/^M[0-9]+ [0-9]+/, '') + exits[index]);
      const total = path.getTotalLength();
      path.style.strokeDasharray = `${length} ${total + length}`;
      return path.animate([
        { strokeDashoffset: `${length}`, offset: 0, easing: 'cubic-bezier(.3, 0, .2, 1)' },
        { strokeDashoffset: `${-entryLength}`, offset: .42 },
        { strokeDashoffset: `${-entryLength}`, offset: .64, easing: 'cubic-bezier(.6, 0, .7, 1)' },
        { strokeDashoffset: `${-total}`, offset: 1 },
      ], { duration: duration - 160, delay: index * 80, fill: 'both' });
    });
    return () => {
      animations.forEach(animation => animation.cancel());
      svg.querySelectorAll('path').forEach((path, index) => {
        path.setAttribute('d', arches[index]);
        path.style.strokeDasharray = '';
      });
    };
  }, []);
  useEffect(() => {
    surface.current?.focus();
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const timer = window.setTimeout(onComplete, motion.matches ? 180 : duration);
    const skip = (event: KeyboardEvent) => {
      // Consume the dismissal key before it can activate a workspace shortcut.
      event.preventDefault();
      event.stopImmediatePropagation();
      onComplete();
    };
    window.addEventListener('keydown', skip, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', skip, true);
    };
  }, [onComplete]);

  return (
    <button ref={surface} className="splash-screen" onClick={onComplete} aria-label="Aegir. Skip introduction">
      <span className="splash-screen__glow" aria-hidden="true" />
      <svg ref={mark} className="splash-screen__mark" viewBox="0 0 360 360" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="splash-lemon" gradientUnits="userSpaceOnUse" x1="40" y1="40" x2="300" y2="310">
            <stop stopColor="var(--ds-color-lemon-soft)" />
            <stop offset=".4" stopColor="var(--ds-color-lemon)" />
            <stop offset="1" stopColor="var(--ds-color-lemon)" />
          </linearGradient>
          <linearGradient id="splash-lime" gradientUnits="userSpaceOnUse" x1="40" y1="40" x2="300" y2="310">
            <stop stopColor="var(--ds-color-lime-soft)" />
            <stop offset=".4" stopColor="var(--ds-color-lime)" />
            <stop offset="1" stopColor="var(--ds-color-lime-strong)" />
          </linearGradient>
        </defs>
        <g strokeWidth="27" strokeLinecap="round" strokeLinejoin="miter">
          {arches.map((d, index) => (
            <path key={index} stroke={`url(#splash-${index === 1 ? 'lime' : 'lemon'})`} d={d} />
          ))}
        </g>
      </svg>
      <span className="splash-screen__name" aria-hidden="true">Aegir</span>
    </button>
  );
}
