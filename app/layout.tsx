import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Oxanium } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const display = Oxanium({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Puzzle — knowledge, in pieces",
  description:
    "See how academic fields fit together. Click a piece to see what it’s made of, search a researcher or paper, and move through time.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Puzzle",
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#050403",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden overscroll-none bg-[var(--void)] text-[var(--ink)]">
        {children}
      </body>
    </html>
  );
}
