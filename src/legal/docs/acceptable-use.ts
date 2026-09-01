import { DOCUMENT_DATES, DOCUMENT_VERSIONS } from "../policy.ts";
import type { LegalDocument } from "../document.ts";

export const acceptableUseDocument: LegalDocument = {
  slug: "acceptable-use",
  title: "Acceptable Use / Content & Likeness Policy",
  version: DOCUMENT_VERSIONS.acceptable_use,
  effective: DOCUMENT_DATES.effective,
  updated: DOCUMENT_DATES.updated,
  summary:
    "Use the Service for lawful creative production, including fictional drama. Do not use it for illegal content, child sexual exploitation, non-consensual intimate imagery, deceptive impersonation, or unauthorized real-person voice or likeness.",
  sections: [
    {
      id: "allow",
      title: "What you may do",
      blocks: [
        {
          type: "p",
          text: "You may use the Service for lawful creative production, including fictional dramatic content. Fictional storytelling that depicts conflict, crime, romance, fear, villains, or dramatic violence is not prohibited merely because it contains those themes.",
        },
      ],
    },
    {
      id: "forbid",
      title: "What you may not do",
      blocks: [
        {
          type: "ul",
          items: [
            "Violate applicable law.",
            "Infringe intellectual-property rights.",
            "Create or seek sexual exploitation of minors, or any sexual content involving anyone 17 or under.",
            "Create non-consensual intimate material.",
            "Impersonate another person for fraud or deception, including voice-clone scams, false endorsements, and deceptive political impersonation.",
            "Clone or use a real person’s voice or likeness without required rights and permission. Custom cloning of real public figures is not offered.",
            "Upload a celebrity or public-figure name or likeness. Named public figures stay blocked.",
            "Target individuals with threats or harassment.",
            "Evade model-provider safety or access controls.",
            "Use the Service where an applicable model or provider term prohibits that use.",
          ],
        },
      ],
    },
    {
      id: "release",
      title: "Real-person materials",
      blocks: [
        {
          type: "p",
          text: "You may upload a private face photo for an account-owned actor. Generation does not start until you confirm you have the necessary likeness rights. That confirmation is stored as a legal_acceptances row with document type likeness_rights and a document version. Named celebrities and public figures remain blocked. Voice cloning from an uploaded recording is not offered.",
        },
      ],
    },
  ],
};
