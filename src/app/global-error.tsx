"use client";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="id">
      <body className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <main className="max-w-lg rounded-3xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-950">Terjadi kesalahan</h1>
          <p className="mt-3 text-slate-600">
            Sistem mengalami kesalahan yang tidak terduga. Detail internal tidak ditampilkan untuk keamanan.
          </p>
          <button
            onClick={reset}
            className="mt-6 rounded-xl bg-slate-950 px-5 py-3 font-medium text-white"
          >
            Coba lagi
          </button>
        </main>
      </body>
    </html>
  );
}
