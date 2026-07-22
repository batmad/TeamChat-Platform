import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentSession } from "@/lib/auth/dal";

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) redirect("/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <section className="w-full max-w-md rounded-3xl bg-white p-8 shadow-sm">
        <div className="mb-8">
          <p className="text-sm font-medium text-slate-500">
            {process.env.NEXT_PUBLIC_METADATA_TITLE}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            Internal Login
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Masuk menggunakan akun internal sistem.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
