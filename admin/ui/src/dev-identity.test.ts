import { afterEach, describe, expect, it } from "vitest";
import { DEV_EMAIL_COOKIE, rememberDevEmail } from "./dev-identity";

afterEach(() => {
  document.cookie = `${DEV_EMAIL_COOKIE}=; max-age=0; path=/`;
});

describe("rememberDevEmail", () => {
  it("stores the dev email in the dh-dev-email cookie, encoded, for the whole site", () => {
    const written: string[] = [];
    const fakeDocument = {
      set cookie(value: string) {
        written.push(value);
      },
    };
    rememberDevEmail("owner@example.com", fakeDocument);
    expect(written).toEqual(["dh-dev-email=owner%40example.com; SameSite=Strict; path=/"]);
  });

  it("is readable back from a real document", () => {
    rememberDevEmail("owner@example.com");
    expect(document.cookie).toContain("dh-dev-email=owner%40example.com");
  });
});
