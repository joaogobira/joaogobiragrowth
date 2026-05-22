import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Plataforma de Criativos AI",
  description: "Gerador Brutalista de Criativos",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.className} bg-neutral-950 text-neutral-200 min-h-screen flex flex-col`}>
        <nav className="bg-neutral-900 border-b border-neutral-800 p-4 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto flex justify-between items-center">
            <Link href="/" className="font-bold text-xl tracking-tighter text-white">
              CRIATIVOS<span className="text-[#C8391A]">.AI</span>
            </Link>
            <div className="flex gap-6 items-center">
              <Link href="/templates" className="text-sm font-medium hover:text-white transition-colors">
                Templates
              </Link>
              <Link href="/criar" className="text-sm font-bold bg-[#C8391A] text-white px-4 py-2 rounded hover:bg-red-700 transition-colors">
                Novo Criativo
              </Link>
            </div>
          </div>
        </nav>
        <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-8">
          {children}
        </main>
      </body>
    </html>
  );
}
