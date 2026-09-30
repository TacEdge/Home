'use server';

import { redirect } from 'next/navigation';
import { signOut } from '@/trust/session';

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect('/sign-in');
}
