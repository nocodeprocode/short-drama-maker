import { DOCUMENT_DATES, DOCUMENT_VERSIONS } from "../policy.ts";
import type { LegalDocument } from "../document.ts";

export const cookiesDocument: LegalDocument = {
  slug: "cookies",
  title: "Cookie Notice",
  version: DOCUMENT_VERSIONS.cookies,
  effective: DOCUMENT_DATES.effective,
  updated: DOCUMENT_DATES.updated,
  summary:
    "We aim to use only cookies and similar storage that are strictly necessary to sign you in and keep the Service secure. We do not currently run advertising trackers or third-party behavioral ads, so there is no consent banner for optional cookies.",
  sections: [
    {
      id: "necessary",
      title: "Strictly necessary",
      blocks: [
        {
          type: "ul",
          items: [
            "Session and authentication.",
            "Security and abuse prevention.",
            "Load balancing and basic availability.",
            "Remembering that you saw this notice, if we ever store a preference.",
          ],
        },
      ],
    },
    {
      id: "optional",
      title: "Optional analytics and marketing",
      blocks: [
        {
          type: "p",
          text: "Not used at this stage. If we later add non-essential analytics or marketing cookies in a region that requires prior consent, Reject will be as easy as Accept, and those cookies will not be set first. Counsel should confirm whether a banner is unnecessary while only necessary cookies are used.",
        },
      ],
    },
  ],
};
