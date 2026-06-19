import { redirect } from "@sveltejs/kit";
import { auth } from "$lib/server/auth";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ request }) => {
  await auth.api.signOut({ headers: request.headers }).catch(() => null);

  return redirect(303, "/");
};
