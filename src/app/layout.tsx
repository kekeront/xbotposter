import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SidebarNav } from "@/components/shell/nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "nfactz · admin",
  description: "Agentic X content engine — admin panel",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="grid min-h-screen grid-cols-[220px_1fr]">
          <aside className="border-r bg-sidebar text-sidebar-foreground">
            <SidebarNav />
          </aside>
          <main className="flex flex-col">{children}</main>
        </div>
      </body>
    </html>
  );
}
