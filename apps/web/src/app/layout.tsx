import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { NearAuthProvider } from '@/lib/auth';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' });

export const metadata: Metadata = {
  title: 'KEIZ — invoice payments on NEAR',
  description:
    'Approve invoices, settle cross-chain with NEAR Intents, and let a policy-bound AI agent handle the busywork.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <NearAuthProvider>{children}</NearAuthProvider>
      </body>
    </html>
  );
}
