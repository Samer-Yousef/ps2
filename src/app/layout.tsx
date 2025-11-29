import type { Metadata } from "next";
import { Neuton } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const neuton = Neuton({
  subsets: ["latin"],
  weight: ["200", "300", "400", "700", "800"],
  variable: "--font-neuton",
});

export const metadata: Metadata = {
  title: "Pathology Search",
  description: "Search and explore pathology cases",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${neuton.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
