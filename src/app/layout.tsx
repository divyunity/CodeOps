import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CodeOps — Autonomous Engineering Command Center',
  description: 'AI-powered engineering operations agent',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ background: '#f8fafc' }}>{children}</body>
    </html>
  );
}
