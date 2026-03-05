import type { Metadata } from "next";
import { Neuton } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Footer } from "@/components/Footer";

const neuton = Neuton({
  subsets: ["latin"],
  weight: ["200", "300", "400", "700", "800"],
  variable: "--font-neuton",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'),
  title: {
    default: 'Pathology Search - Medical Education Case Database',
    template: '%s | Pathology Search',
  },
  description: 'Comprehensive pathology case database for medical education. Search 26,000+ pathology cases with detailed microscopy, clinical data, and diagnoses.',
  keywords: [
    'pathology cases',
    'medical education',
    'histopathology',
    'microscopy',
    'pathology database',
    'medical students',
    'pathology residents',
    'anatomical pathology',
    'clinical pathology',
  ],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: '/',
    siteName: 'Pathology Search',
    title: 'Pathology Search - Medical Education Case Database',
    description: 'Comprehensive pathology case database for medical education with 26,000+ cases.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pathology Search - Medical Education Case Database',
    description: 'Comprehensive pathology case database for medical education.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  category: 'Medical Education',
  alternates: {
    canonical: '/',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

  // Structured data for the website
  const websiteStructuredData = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Pathology Search",
    "description": "Medical education pathology case database",
    "url": baseUrl,
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": `${baseUrl}?q={search_term_string}`
      },
      "query-input": "required name=search_term_string"
    },
    "audience": {
      "@type": "MedicalAudience",
      "audienceType": ["Medical Students", "Pathology Residents"]
    }
  };

  const datasetStructuredData = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    "name": "Pathology Search Case Database",
    "description": "Comprehensive pathology cases for medical education",
    "url": baseUrl,
    "keywords": ["pathology", "histopathology", "medical education"],
    "creator": {
      "@type": "Organization",
      "name": "Pathology Search"
    }
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteStructuredData) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetStructuredData) }}
        />
      </head>
      <body className={`${neuton.variable} antialiased flex flex-col min-h-screen`}>
        {gaId && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${gaId}', {
                  anonymize_ip: true,
                  cookie_flags: 'SameSite=None;Secure'
                });
              `}
            </Script>
          </>
        )}
        <Providers>
          <div className="flex-1">{children}</div>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
