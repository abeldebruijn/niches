import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import type { Metadata } from "next";
import { Baloo_2, JetBrains_Mono, Manrope } from "next/font/google";

import ConvexClientProvider from "@/components/ConvexClientProvider";
import "./globals.css";
import { Toaster } from "sonner";

const bodyFont = Manrope({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const displayFont = Baloo_2({
  variable: "--font-display",
  subsets: ["latin"],
});

const monoFont = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Question Crafter",
  description: "Playful multiplayer trivia setup with Convex + Next.js",
  icons: {
    icon: "/convex.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en">
        <body
          className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable} antialiased`}
        >
          <ConvexClientProvider>{children}</ConvexClientProvider>

           <Toaster />
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
