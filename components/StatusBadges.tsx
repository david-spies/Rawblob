// components/StatusBadges.tsx
//
// Small semantic indicators used throughout the Telemetry Matrix and
// Reconstruction Canvas. Kept as plain, legible labels — never just a
// color swatch — since forensic output should be scannable at a glance
// but never ambiguous about what it means.

interface EntropyBadgeProps {
  score: number;
  confidence: 'low' | 'medium' | 'high';
  consistent: boolean;
}

export function EntropyBadge({ score, confidence, consistent }: EntropyBadgeProps) {
  const tone = score >= 7.2 ? 'red' : score >= 4.0 ? 'amber' : 'teal';
  const toneClasses: Record<string, string> = {
    red: 'bg-rb-red-dim text-rb-red border-rb-red/30',
    amber: 'bg-rb-amber-dim text-rb-amber border-rb-amber/30',
    teal: 'bg-rb-teal-dim text-rb-teal border-rb-teal/30',
  };

  return (
    <div className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center rounded-rb border px-1.5 py-0.5 text-xs font-mono ${toneClasses[tone]}`}>
        H {score.toFixed(2)}
      </span>
      {confidence === 'low' && (
        <span
          className="text-[10px] text-rb-faint font-mono uppercase tracking-wide"
          title="Sample size too small for a statistically reliable entropy reading"
        >
          low-n
        </span>
      )}
      {!consistent && confidence !== 'low' && (
        <span
          className="text-[10px] text-rb-red font-mono uppercase tracking-wide"
          title="Entropy doesn't match what's expected for this file type — worth a closer look"
        >
          inconsistent
        </span>
      )}
    </div>
  );
}

interface SignatureBadgeProps {
  name: string;
  weak: boolean;
}

export function SignatureBadge({ name, weak }: SignatureBadgeProps) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-sm text-rb-text">{name}</span>
      {weak && (
        <span
          className="inline-flex items-center rounded-rb border border-rb-amber/30 bg-rb-amber-dim px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-rb-amber"
          title="Short or easily-collided signature — treat as a lead, not a confirmed identification"
        >
          weak sig
        </span>
      )}
    </div>
  );
}

interface RenderModeBadgeProps {
  mode: 'image' | 'text' | 'sandboxed' | 'inert';
}

export function RenderModeBadge({ mode }: RenderModeBadgeProps) {
  const map: Record<RenderModeBadgeProps['mode'], { label: string; tone: string }> = {
    image: { label: 'Previewable', tone: 'bg-rb-teal-dim text-rb-teal border-rb-teal/30' },
    text: { label: 'Text', tone: 'bg-rb-panel-raised text-rb-muted border-rb-hairline' },
    sandboxed: { label: 'Sandboxed', tone: 'bg-rb-amber-dim text-rb-amber border-rb-amber/30' },
    inert: { label: 'Executable — Inert', tone: 'bg-rb-red-dim text-rb-red border-rb-red/30' },
  };
  const { label, tone } = map[mode];
  return (
    <span className={`inline-flex items-center rounded-rb border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide ${tone}`}>
      {label}
    </span>
  );
}
