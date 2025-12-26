import { SignJWT, jwtVerify } from "jose";
import { NextResponse } from "next/server";

const ADMIN_COOKIE_NAME = "foodbuddy_admin";

const getAdminSecret = () => {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    throw new Error("ADMIN_JWT_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
};

const getSessionDays = () => {
  const days = Number(process.env.ADMIN_SESSION_DAYS ?? "7");
  if (Number.isNaN(days) || days <= 0) {
    return 7;
  }
  return days;
};

export const signAdminToken = async () => {
  const sessionDays = getSessionDays();
  return new SignJWT({ admin: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${sessionDays}d`)
    .sign(getAdminSecret());
};

export const verifyAdminToken = async (token: string) => {
  await jwtVerify(token, getAdminSecret());
  return { ok: true } as const;
};

export const setAdminCookie = (res: NextResponse, token: string) => {
  const sessionDays = getSessionDays();
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: sessionDays * 24 * 60 * 60,
  });
};

export const clearAdminCookie = (res: NextResponse) => {
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
};

export const adminCookieName = ADMIN_COOKIE_NAME;
