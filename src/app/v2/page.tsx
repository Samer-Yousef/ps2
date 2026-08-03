import { redirect } from 'next/navigation';

// /v2 became the site root on 2026-08-03. Preserve the query string so old
// preview links like /v2?modal=b keep working.
export default async function V2Redirect({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') qs.set(k, v);
    else if (Array.isArray(v)) for (const x of v) qs.append(k, x);
  }
  const s = qs.toString();
  redirect(s ? `/?${s}` : '/');
}
