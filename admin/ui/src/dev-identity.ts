export const DEV_EMAIL_COOKIE = "dh-dev-email";

// In local development the Worker also accepts the dev identity from this
// cookie, because <img> requests for previews cannot carry the
// x-dev-email header. It is only ever called from a development build.
export function rememberDevEmail(email: string, target: { cookie: string } = document): void {
  target.cookie = `${DEV_EMAIL_COOKIE}=${encodeURIComponent(email)}; SameSite=Strict; path=/`;
}
