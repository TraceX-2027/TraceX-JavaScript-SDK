import React from 'react';
import type { Metadata } from 'next';
import './globals.css';
import { TraceXClientProvider } from '@tracex-dev/nextjs/client';

export const metadata: Metadata = {
  title: 'TraceX Next.js 16 Showcase | Dark Developer Dashboard',
  description: 'Interactive testbed showcasing TraceX full-stack crash observability in Next.js App Router',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background text-slate-100 min-h-screen antialiased selection:bg-brand-500 selection:text-white">
        <TraceXClientProvider
          options={{
            projectKey:
              process.env.NEXT_PUBLIC_TRACEX_PROJECT_KEY || 'tracex_live_demo_00000000',
            endpoint:
              process.env.NEXT_PUBLIC_TRACEX_ENDPOINT ||
              'https://tracex-edge-ingest.kareemadel10110.workers.dev/api/v1/crashes',
            environment:
              process.env.NEXT_PUBLIC_TRACEX_ENVIRONMENT || 'development',
          }}
        >
          {children}
        </TraceXClientProvider>
      </body>
    </html>
  );
}
