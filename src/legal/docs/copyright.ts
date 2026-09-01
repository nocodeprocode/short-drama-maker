import { DOCUMENT_DATES, DOCUMENT_VERSIONS } from "../policy.ts";
import { displayField, LEGAL_ENTITY } from "../entity.ts";
import type { LegalDocument } from "../document.ts";

const copyright = displayField(LEGAL_ENTITY.copyright_email, "[COPYRIGHT_EMAIL]");

export const copyrightDocument: LegalDocument = {
  slug: "copyright",
  title: "Copyright and intellectual-property complaints",
  version: DOCUMENT_VERSIONS.copyright,
  effective: DOCUMENT_DATES.effective,
  updated: DOCUMENT_DATES.updated,
  summary:
    "If you believe project content on the Service infringes your rights, send a complete complaint to the copyright contact. This is not a global DMCA process unless counsel later implements one.",
  sections: [
    {
      id: "how",
      title: "How to complain",
      blocks: [
        {
          type: "p",
          text: `Email ${copyright} with the information below. Incomplete reports may be delayed.`,
        },
        {
          type: "ul",
          items: [
            "Your name and contact details.",
            "A description of the work you claim is infringed.",
            "The location or identifier of the content on the Service (project, episode, or URL if you have one).",
            "The basis of the claim.",
            "A good-faith statement that the use is not authorized by the owner, its agent, or the law.",
            "A statement that you are authorized to act, and a signature or typed confirmation.",
          ],
        },
      ],
    },
    {
      id: "dmca",
      title: "U.S. DMCA",
      blocks: [
        {
          type: "p",
          text: "We have not designated a U.S. DMCA agent or implemented a DMCA-specific process on this page. If that is added later, it will appear as a separate section with the agent’s details.",
        },
      ],
    },
  ],
};
