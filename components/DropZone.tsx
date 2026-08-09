// components/DropZone.tsx
//
// Ingest panel. Accepts drag-and-drop or click-to-browse, validates format
// and the 15MB ceiling client-side before anything touches the worker, and
// gives clear, specific feedback rather than a generic "invalid file" state.

'use client';

import { useCallback, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const ACCEPTED_EXTENSIONS = ['.txt', '.pdf', '.docx', '.rtf', '.md', '.csv', '.log', '.json'];
const MAX_BYTES = 15 * 1024 * 1024;

export type DropZoneStatus = 'idle' | 'analyzing' | 'error';

interface DropZoneProps {
  status: DropZoneStatus;
  errorMessage?: string | null;
  onFileAccepted: (file: File) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function validate(file: File): string | null {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return `"${ext}" isn't a supported format. Accepted: ${ACCEPTED_EXTENSIONS.join(', ')}`;
  }
  if (file.size > MAX_BYTES) {
    return `File is ${formatBytes(file.size)}, which exceeds the 15 MB analysis ceiling.`;
  }
  return null;
}

export function DropZone({ status, errorMessage, onFileAccepted }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      const validationError = validate(file);
      if (validationError) {
        setLocalError(validationError);
        return;
      }
      setLocalError(null);
      onFileAccepted(file);
    },
    [onFileAccepted]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const displayedError = errorMessage ?? localError;

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a file here or press Enter to browse for one"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-rb border-2 border-dashed px-8 py-14 text-center cursor-pointer transition-colors ${
          isDragging ? 'border-rb-amber bg-rb-amber-dim' : 'border-rb-hairline bg-rb-panel hover:border-rb-faint'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          onChange={(e) => handleFiles(e.target.files)}
        />

        <motion.div
          animate={isDragging ? { scale: 1.08 } : { scale: 1 }}
          transition={{ duration: 0.15 }}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-rb-panel-raised border border-rb-hairline"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-rb-amber">
            <path
              d="M12 3v12m0 0-4-4m4 4 4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.div>

        <div>
          <p className="text-rb-text font-medium">Drop a file to scan, or click to browse</p>
          <p className="mt-1 text-sm text-rb-muted font-mono">
            TXT · PDF · DOCX · RTF · MD · CSV · LOG · JSON — up to 15 MB
          </p>
        </div>

        <p className="text-xs text-rb-faint max-w-md">
          Files are parsed entirely in your browser. Nothing is uploaded or stored server-side.
        </p>

        <AnimatePresence>
          {status === 'analyzing' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-rb bg-rb-bg/90 backdrop-blur-sm"
            >
              <div className="flex gap-1.5" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="h-2 w-2 rounded-full bg-rb-amber"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
              </div>
              <p className="text-sm font-mono text-rb-amber">Scanning byte stream…</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {displayedError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="rounded-rb border border-rb-red/30 bg-rb-red-dim px-4 py-2.5 text-sm text-rb-red"
          >
            {displayedError}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
