import { Home } from '@/components/Home';
import { getCurrentUser } from '@/lib/dal';

export const dynamic = 'force-dynamic';

// Thin server-component shell that reads the current user once and
// hands it to the SPA client component. The cart itself remains
// per-device (localStorage UUID), so login is only used to surface
// the admin link.
export default async function Page() {
  const user = await getCurrentUser();
  return (
    <Home
      currentUser={
        user
          ? { email: user.email, role: user.role ?? 'user' }
          : null
      }
    />
  );
}
