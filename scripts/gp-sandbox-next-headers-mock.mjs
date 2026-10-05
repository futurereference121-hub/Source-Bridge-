/** Test double for next/headers. The ticket-form regression supplies the cookie jar. */
export function cookies() {
  const jar = globalThis.__SB_COOKIE_JAR;
  if (!jar) throw new Error("cookie jar is not installed");
  return jar;
}

export function headers() {
  return new Headers();
}

export function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} };
}
