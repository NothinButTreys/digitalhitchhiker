// A real browser remembers the element focused when showModal() is called and,
// when the dialog is closed through close() (which covers Escape and a dialog
// form too), restores focus to it if it is still in the document. jsdom has no
// dialog behaviour at all, so these stubs imitate that faithfully.
// `modal` records which of the two ways a dialog was opened, for tests to read.
type Opened = { openedBy: Element | null; modal: boolean };
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
  Object.assign(this as unknown as Opened, { openedBy: document.activeElement, modal: true });
  this.setAttribute("open", "");
};
// show() opens a dialog without making the rest of the page inert. Not every
// browser gives focus back when such a dialog closes, so this stub does not:
// whatever the admin needs there, it has to do itself.
HTMLDialogElement.prototype.show = function show(this: HTMLDialogElement) {
  Object.assign(this as unknown as Opened, { openedBy: null, modal: false });
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
  // Closing a dialog that is not open does nothing, as in a browser.
  if (!this.hasAttribute("open")) return;
  this.removeAttribute("open");
  const opener = (this as unknown as { openedBy: Element | null }).openedBy;
  if (opener && document.contains(opener)) (opener as HTMLElement).focus();
  this.dispatchEvent(new Event("close"));
};
