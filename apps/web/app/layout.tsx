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
  const showGitHubPagesNotice =
    process.env.NEXT_PUBLIC_GITHUB_PAGES === 'true' && !process.env.NEXT_PUBLIC_API_URL?.trim();

  return (
    <html lang="vi" suppressHydrationWarning>
      <body className={`${geist.variable} ${mono.variable}`}>
        {showGitHubPagesNotice && (
          <div className="border-b border-amber-300/30 bg-amber-300/10 px-4 py-2 text-center text-xs text-amber-100">
            GitHub Pages đang trình diễn giao diện frontend. Cấu hình <code>NEXT_PUBLIC_API_URL</code> để kết nối dữ liệu thật.
          </div>
        )}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
