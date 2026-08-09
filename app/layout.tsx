// app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Rawblob — Forensic File Carving',
  description: 'Client-side forensic file carving and reconstruction. Nothing is uploaded or stored server-side.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-rb-bg text-rb-text antialiased">{children}</body>
    </html>
  );
}
