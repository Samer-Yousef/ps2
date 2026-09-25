import type { Metadata } from 'next';
import Link from 'next/link';
import './catalogue.css';

export const metadata: Metadata = {
  title: { default: 'Catalogue', template: '%s · Catalogue | Pathology Search' },
  robots: { index: false, follow: false },
};

export default function CatalogueLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cat">
      <header className="cat-bar">
        <Link href="/" className="cat-wordmark">Pathology Search</Link>
        <nav className="cat-nav">
          <Link href="/catalogue">Catalogue</Link>
          <Link href="/catalogue/tags">Tags</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
