import "server-only";
import { cookies } from "next/headers";
import { adminAuth } from "@/src/lib/firebase/admin";

export const SESSION_COOKIE_NAME = "__tx_session";

export type SessionUser = {
  uid: string;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const decoded = await adminAuth().verifySessionCookie(token, true);
    return {
      uid: decoded.uid,
      email: (decoded.email as string) || null,
      name: (decoded.name as string) || null,
      picture: (decoded.picture as string) || null,
    };
  } catch {
    return null;
  }
}

export async function requireSessionUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new Error("Unauthorized");
  return u;
}
