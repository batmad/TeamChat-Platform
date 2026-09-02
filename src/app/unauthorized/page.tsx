import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <section className="max-w-lg rounded-3xl bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold text-red-600">403</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">Access denied</h1>
        <p className="mt-3 text-slate-600">Akun Anda tidak memiliki permission untuk membuka halaman ini.</p>
        <Link href="/dashboard" className="mt-6 inline-block rounded-xl bg-slate-950 px-5 py-3 text-sm font-medium text-white">
          Kembali
        </Link>
      </section>
    </main>
  );
}
