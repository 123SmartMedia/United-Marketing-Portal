import { cookies } from 'next/headers';
import { isAuthed, isAdminConfigured } from '@/lib/adminAuth';
import { readPosts } from '@/lib/posts';
import { getCategories } from '@/lib/catalog';
import { CATEGORY_GROUP_OPTIONS } from '@/lib/groups';
import LoginForm from '@/components/admin/LoginForm';
import AdminDashboard from '@/components/admin/AdminDashboard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin', robots: { index: false, follow: false } };

export default async function AdminPage() {
  if (!isAdminConfigured()) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-2xl font-bold text-navy-900">Admin not configured</h1>
        <p className="mt-3 text-navy-500">
          Set <code className="rounded bg-navy-50 px-1">ADMIN_PASSWORD</code> in the environment to enable the admin area.
        </p>
      </div>
    );
  }

  const cookieStore = await cookies();
  if (!isAuthed(cookieStore)) {
    return (
      <div className="mx-auto flex max-w-md flex-col px-4 py-24">
        <h1 className="text-2xl font-bold text-navy-900">Marketing Desk Admin</h1>
        <p className="mt-2 text-sm text-navy-500">Sign in to add and manage content.</p>
        <div className="mt-6">
          <LoginForm />
        </div>
      </div>
    );
  }

  const categories = getCategories().map((c) => ({ slug: c.slug, title: c.title }));
  const posts = await readPosts();

  return (
    <AdminDashboard
      categories={categories}
      groupOptions={CATEGORY_GROUP_OPTIONS}
      initialPosts={posts}
    />
  );
}
