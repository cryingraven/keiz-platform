import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { NearAuthProvider } from '@/lib/auth';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' });

export const metadata: Metadata = {
  title: 'KEIZ — bills, invoices and books in one place',
  description:
    'Approve vendor bills, send customer invoices, pay across chains and keep a double-entry ledger in balance. TEE-backed custody and private AI inference.',
  openGraph: {
    title: 'KEIZ — bills, invoices and books in one place',
    description:
      'One workspace for vendor bills, customer invoices, approvals, payments and the books behind them. TEE-backed custody and private AI.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'KEIZ — bills, invoices and books in one place',
    description:
      'One workspace for vendor bills, customer invoices, approvals, payments and the books behind them. TEE-backed custody and private AI.',
  },
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
