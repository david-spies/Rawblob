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

interface FooterStatusBadgeProps {
  footerFound: boolean;
  hasStandardFooter: boolean;
}

export function FooterStatusBadge({ footerFound, hasStandardFooter }: FooterStatusBadgeProps) {
  if (!hasStandardFooter) {
    // Formats like MP3/MP4/WAV/EXE/RAR have no standardized trailer at all —
    // an "unbounded" size here is expected, not a red flag, so keep this quiet.
    return (
      <span
        className="inline-flex items-center rounded-rb border border-rb-hairline bg-rb-panel-raised px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-rb-faint"
        title="This format has no standardized end-of-file marker — size is derived from format-specific structure, not a trailing signature"
      >
        no std. footer
      </span>
    );
  }
  if (footerFound) {
    return (
      <span className="inline-flex items-center rounded-rb border border-rb-teal/30 bg-rb-teal-dim px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-rb-teal">
        footer confirmed
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-rb border border-rb-red/30 bg-rb-red-dim px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide text-rb-red"
      title="Expected end-of-file marker wasn't found — the end offset falls back to the rest of the buffer and is an estimate, not confirmed"
    >
      unbounded
    </span>
  );
}

interface StructureBadgeProps {
  confidence: 'high' | 'medium' | 'low';
  markersFound: string[];
}

export function StructureBadge({ confidence, markersFound }: StructureBadgeProps) {
  // Header/footer bytes alone can be coincidental — this reflects whether
  // real structure intrinsic to the format (obj/endobj, stream, xref,
  // trailer, /Root for PDF) was actually found inside the carved range,
  // not just claimed by matching boundary bytes.
  const map: Record<StructureBadgeProps['confidence'], { label: string; tone: string; title: string }> = {
    high: {
      label: 'structure verified',
      tone: 'bg-rb-teal-dim text-rb-teal border-rb-teal/30',
      title: `Interior structure confirmed (${markersFound.join(', ') || 'no markers'}) — this is genuine content, not just a header/footer match`,
    },
    medium: {
      label: 'structure partial',
      tone: 'bg-rb-amber-dim text-rb-amber border-rb-amber/30',
      title: `Some interior structure found (${markersFound.join(', ') || 'no markers'}) but limited corroboration — plausible for newer PDF variants, still worth a closer look`,
    },
    low: {
      label: 'structure not found',
      tone: 'bg-rb-red-dim text-rb-red border-rb-red/30',
      title: 'No object-model structure found inside this range — the header/footer bytes may be a coincidental match rather than genuine content',
    },
  };
  const { label, tone, title } = map[confidence];
  return (
    <span
      className={`inline-flex items-center rounded-rb border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide ${tone}`}
      title={title}
    >
      {label}
    </span>
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
