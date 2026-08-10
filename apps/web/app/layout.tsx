import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { Providers } from '@/components/providers';
import './globals.css';

const geist = Geist({ subsets: ['latin', 'latin-ext'], variable: '--font-sans' });
const mono = Geist_Mono({ subsets: ['latin', 'latin-ext'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'OmniSocial — Social operations',
  description: 'Consent-aware social management and automation platform',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className={`${geist.variable} ${mono.variable}`}><Providers>{children}</Providers></body>
    </html>
  );
}
