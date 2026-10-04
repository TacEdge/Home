// Pieces for pages outside the HOME shell: sign-in and the calm error and
// not-found pages. Inside the shell, use src/ui/page.tsx.

export { Headline, Quiet } from './page';

/** A standalone page with its own <main>, for screens outside the shell. */
export function CalmPage({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-[720px] px-5 py-8">{children}</main>;
}
