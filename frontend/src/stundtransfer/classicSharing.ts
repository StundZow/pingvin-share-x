// StundTransfer: Pingvin's classic sharing (upload page, "Mes partages",
// "Partages inversés") is hidden unless enabled in
// Administration > Paramètres > StundTransfer.

/** Pages of the classic sharing, redirected to the deposits when it is hidden. */
export const CLASSIC_SHARING_ROUTES = [
  "/upload",
  "/account/shares",
  "/account/reverseShares",
  "/admin/shares",
];

export const DEPOSITS_PAGE = "/account/deposits";

export function isClassicSharingEnabled(get: (key: string) => any): boolean {
  try {
    return get("stundtransfer.classicSharing") === true;
  } catch {
    // Unknown setting (e.g. config not loaded yet): stay hidden
    return false;
  }
}
