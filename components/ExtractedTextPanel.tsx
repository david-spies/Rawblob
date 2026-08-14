// components/ExtractedTextPanel.tsx
//
// Shows the actual text pulled out of a PDF/DOCX (or read directly from a
// plain-text file). Previously, extracted text was only ever used as an
// input to the Base64 scanner — if a document had no embedded payloads
// (the common case), extraction produced zero new Telemetry Matrix rows
// and nothing else visible changed, with no way to see what was actually
// extracted. This panel closes that gap. Collapsed by default, same
// pattern as PatternSearchPanel, to avoid competing with the primary
// Drop → Matrix → Canvas flow.

'use client';

import { useState } from 'react';

interface ExtractedTextPanelProps {
  text: string;
  textLength: number;
  truncated: boolean;
  payloadCount: number;
  warning?: string;
  sourceLabel: string; // e.g. "test.pdf" or "extracted via pdfjs-dist"
}

export function ExtractedTextPanel({ text, textLength, truncated, payloadCount, warning, sourceLabel }: ExtractedTextPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-rb border border-rb-hairline bg-rb-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-rb-panel-raised transition-colors"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-rb-text">Extracted Document Text</span>
          <span className="text-xs text-rb-faint font-mono">
            {textLength.toLocaleString()} chars · {payloadCount} payload{payloadCount === 1 ? '' : 's'} found · {sourceLabel}
          </span>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className={`text-rb-faint transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-rb-hairline px-5 py-4 flex flex-col gap-3">
          {warning && (
            <p className="text-xs text-rb-amber font-mono">{warning}</p>
          )}
          {textLength === 0 ? (
            <p className="text-sm text-rb-muted">No text content was extracted from this document.</p>
          ) : (
            <>
              <pre className="max-h-80 overflow-auto rounded-rb border border-rb-hairline bg-rb-bg p-3 text-xs font-mono text-rb-text whitespace-pre-wrap break-words">
                {text}
              </pre>
              {truncated && (
                <p className="text-xs text-rb-faint font-mono">
                  Display truncated at 200,000 characters — the full text was still scanned for embedded payloads above.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
