import { redirect } from 'next/navigation';

// HOME always opens on Today. The (home) layout handles sign-in.
export default function RootPage() {
  redirect('/today');
}
