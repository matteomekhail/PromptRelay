import type { Metadata } from "next";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import { Navbar } from "@/components/navbar";
import "./globals.css";

const neueMontreal = localFont({
  src: "../../public/fonts/NeueMontreal-Regular.otf",
  variable: "--font-app-sans",
  display: "swap",
});

const migra = localFont({
  src: "../../public/fonts/Migra-Extrabold.woff2",
  variable: "--font-app-heading",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PromptRelay",
  description: "Volunteer AI execution network for open-source maintainers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${neueMontreal.variable} ${migra.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>
          <Navbar />
          <main className="flex-1">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
