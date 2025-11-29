## Quick context for AI coding agents

This repository is a Next.js (app router) TypeScript project created with `create-next-app`.
Keep responses concise and make minimal, well-scoped edits. When in doubt, run the dev server locally and validate builds.

Key facts (quick scan):
- Root files: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`.
- Source lives under `src/` with the App Router at `src/app/`. Primary entry page: `src/app/page.tsx`.
- Global styles: `src/app/globals.css` (Tailwind via `postcss.config.mjs`).
- TypeScript path alias: `@/*` -> `./src/*` (see `tsconfig.json`). Use `@/` imports for project files.
- Next and React versions: `next@16`, `react@19` (do not change versions unless instructed).

Developer workflows (what to run):
- Start development: `npm run dev` (runs `next dev --webpack`).
- Build: `npm run build` (runs `next build --webpack`).
- Start production server: `npm run start`.
- Lint: `npm run lint` (invokes `eslint`, config in `eslint.config.mjs`).

Project-specific conventions & patterns
- Uses the Next.js App Router (server components by default). Files under `src/app/` are the canonical locations for pages and layout.
- `src/app/layout.tsx` contains the global layout and loads the Geist font via `next/font/google`.
- Place new components under `src/components/` and import them using the `@/` alias: `import X from '@/components/X'`.
- CSS is Tailwind-managed; `postcss.config.mjs` enables `@tailwindcss/postcss`. Keep Tailwind utility classes in JSX rather than long CSS when possible.
- The `public/` folder is for static assets. The project has been cleaned up and only essential files remain.

Examples to reference
- Edit the main page: `src/app/page.tsx` — clean functional component with minimal Tailwind classes.
- Global layout and font usage: `src/app/layout.tsx` — demonstrates loading `next/font/google` (Geist font).
- Scripts: see `package.json` for `dev`, `build`, `start`, `lint` and note the explicit `--webpack` flags.

Integration points & external deps
- Vercel is the implied deployment target (default for Next.js projects). Keep serverless-friendly code (no native binaries required at build time).
- Critical deps: `next`, `react`, `tailwindcss`, `@tailwindcss/postcss`, `eslint`. The project has no test framework configured.

AI editing guidance (do this project-specific checklist when proposing changes)
1. Keep edits inside `src/` unless asked to change config files. Use the `@/` alias for imports.
2. Preserve TypeScript strictness: provide explicit types for exported components and props where applicable.
3. When altering styling, prefer Tailwind utility classes (follow patterns in `page.tsx`) and update `globals.css` if adding tokens.
4. When updating build/lint config, keep `--webpack` flags intact and do not upgrade major `next`/`react` versions without confirmation.
5. Run `npm run dev` locally and confirm the dev server loads `http://localhost:3000` and the edited pages render without TypeScript errors.

If you modify project structure, update `tsconfig.json` `paths` accordingly and document the change in a short README fragment.

Where to look first (files to open for orientation)
- `package.json` — scripts and versions
- `tsconfig.json` — path aliases (`@/*`)
- `src/app/layout.tsx`, `src/app/page.tsx` — examples of layout, font usage, Tailwind patterns
- `src/app/globals.css` — global styles and Tailwind base
- `postcss.config.mjs`, `eslint.config.mjs` — build/lint tooling

If anything is unclear or you need a different focus (tests, API routes, SSR patterns), ask before making large changes.

-- End of instructions --
