import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"

export default async function RagSearchPage() {
  const { userId } = await auth()
  if (!userId) {
    redirect("/sign-in")
  }

  redirect("/dashboard?mode=chat")
}
