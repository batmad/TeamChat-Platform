import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/dal";

export default async function Home() {
  const session = await getCurrentSession();
  redirect(session ? "/dashboard" : "/login");
}
