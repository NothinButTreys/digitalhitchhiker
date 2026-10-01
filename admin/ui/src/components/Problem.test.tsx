import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Problem } from "./Problem";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Problem", () => {
  it("renders nothing for null", () => {
    const { container } = render(<Problem error={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the message in an alert with no button for an ordinary error", () => {
    render(<Problem error={{ code: "duplicate", message: "Already in the library." }} />);
    expect(screen.getByRole("alert").textContent).toBe("Already in the library.");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("adds a Reload the page button for signed_out", () => {
    render(<Problem error={{ code: "signed_out", message: "You have been signed out. Reload the page to sign in again." }} />);
    expect(screen.getByRole("alert").textContent).toBe("You have been signed out. Reload the page to sign in again.");
    expect(screen.getByRole("button", { name: "Reload the page" })).toBeTruthy();
  });

  it("adds a Reload the page button for network", () => {
    render(<Problem error={{ code: "network", message: "Could not reach the library. Check your connection." }} />);
    expect(screen.getByRole("alert").textContent).toBe("Could not reach the library. Check your connection.");
    expect(screen.getByRole("button", { name: "Reload the page" })).toBeTruthy();
  });

  it("calls reload when the button is pressed", async () => {
    const reload = vi.fn();
    render(<Problem error={{ code: "signed_out", message: "You have been signed out." }} reload={reload} />);
    await userEvent.click(screen.getByRole("button", { name: "Reload the page" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
