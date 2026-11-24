// Serialises the read-sign-submit-recordInvoice sequence for one server process.
//
// The ICV and PIH are a chain: two checkouts that read the same state and both sign invoice N would
// produce two different documents with the same counter value, which ZATCA rejects (or worse, one
// silently invalidates the other). A module-level promise chain is enough for this single-process
// dev server; a multi-instance deployment must move this lock into the database.
let tail: Promise<void> = Promise.resolve();

export function withInvoiceChainLock<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work, work);
  tail = result.then(() => undefined, () => undefined);
  return result;
}
