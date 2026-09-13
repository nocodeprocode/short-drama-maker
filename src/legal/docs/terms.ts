import { DOCUMENT_DATES, DOCUMENT_VERSIONS } from "../policy.ts";
import { displayField, LEGAL_ENTITY, operatorLine } from "../entity.ts";
import type { LegalDocument } from "../document.ts";

const legal = displayField(LEGAL_ENTITY.legal_email, "[LEGAL_EMAIL]");
const copyright = displayField(LEGAL_ENTITY.copyright_email, "[COPYRIGHT_EMAIL]");
const mor = displayField(LEGAL_ENTITY.merchant_of_record, "[MERCHANT_OF_RECORD]");

export const termsDocument: LegalDocument = {
  slug: "terms",
  title: "Terms of Service",
  version: DOCUMENT_VERSIONS.terms,
  effective: DOCUMENT_DATES.effective,
  updated: DOCUMENT_DATES.updated,
  summary:
    "You keep the rights you have in what you upload. We need a limited license to process your content so we can make the videos, voices, and other outputs you request. You must have permission to use any third-party material, voice, or likeness you upload. AI generation is probabilistic and may require regeneration. Do not use the Service for infringement, fraud, non-consensual impersonation, or other unlawful activity.",
  counsel_note:
    "Governing law and dispute forum are intentionally unpublished until UAE counsel chooses them. Do not treat a U.S. arbitration clause copied from a vendor as our clause.",
  sections: [
    {
      id: "agreement",
      title: "1. Agreement",
      blocks: [
        { type: "p", text: operatorLine() },
        {
          type: "p",
          text: "These Terms form a contract between you and the Company when you create an account or otherwise use the Service. The Privacy Policy and Acceptable Use Policy are part of this relationship. Creating an account is an affirmative action that agrees to these Terms and acknowledges the Privacy Policy.",
        },
      ],
    },
    {
      id: "eligibility",
      title: "2. Who may use the Service",
      blocks: [
        {
          type: "p",
          text: "You must be at least 18 years old, or the age of legal majority required to enter a binding agreement in your jurisdiction, to create an account.",
        },
      ],
    },
    {
      id: "accounts",
      title: "3. Accounts",
      blocks: [
        {
          type: "p",
          text: "You are responsible for your credentials and for activity on the account. We may require identity verification for privacy requests, payments, or abuse investigations.",
        },
      ],
    },
    {
      id: "service",
      title: "4. Service",
      blocks: [
        {
          type: "p",
          text: "Takehaus helps you turn a story into a vertical drama: a persistent cast, dialogue-first scenes, independently regenerable shots, and a finished episode assembled from a render manifest. We orchestrate storage, jobs, and approved AI processors. We do not promise a general-purpose AI studio.",
        },
      ],
    },
    {
      id: "ai",
      title: "5. AI-powered features",
      blocks: [
        {
          type: "p",
          text: "AI-generated results are probabilistic and may contain errors, artifacts, inconsistencies, or unexpected content. A generation that consumes compute does not guarantee that the output will meet your creative expectations.",
        },
        {
          type: "p",
          text: "Technical failure — no playable output, or a provider failure we can confirm — is eligible for retry or credit restoration under the then-current generation policy. Subjective dissatisfaction — the file rendered but you dislike the acting or style — is handled by regenerating the smallest broken object, not by treating every dislike as a refund.",
        },
        {
          type: "p",
          text: "Some features may be labeled beta or experimental. Seedance audio-reference behavior, Seedance 2.5 audio handling, and undocumented processing regions are in that category until we measure them.",
        },
      ],
    },
    {
      id: "credits",
      title: "6. Credits, usage and generation costs",
      blocks: [
        {
          type: "p",
          text: "The current commercial model is a one-time project payment that funds a prepaid provider-cost budget, not open-ended metering. Jobs reserve budget before they submit. Insufficient headroom blocks the job. We will not describe purchased value as “credits have no value” if consumer law in a target market treats them otherwise. Counsel must align this section with the Merchant of Record and those markets before sale.",
        },
      ],
    },
    {
      id: "payments",
      title: "7. Payments and Merchant of Record",
      blocks: [
        {
          type: "p",
          text: `Purchases may be processed and sold by our Merchant of Record, ${mor}, which may act as the seller of record for the transaction and handle payment collection, applicable indirect taxes, invoices, refunds, and chargebacks under its terms. We do not claim that we are always the seller if the MoR contract says otherwise.`,
        },
      ],
    },
    {
      id: "inputs",
      title: "8. Your Inputs",
      blocks: [
        {
          type: "p",
          text: "As between you and us, you retain the rights you have in scripts, prompts, images, audio, video, reference material, and other content you submit to the Service (“Inputs”). We do not claim ownership of your Inputs.",
        },
        {
          type: "p",
          text: "You represent that you have the rights, licenses, permissions, and consents necessary to submit and use your Inputs and to instruct us and our service providers to process them, including copyright, trademark, privacy, publicity, voice, likeness, confidentiality, music rights, and actor or model releases.",
        },
      ],
    },
    {
      id: "license",
      title: "9. License needed to provide the Service",
      blocks: [
        {
          type: "p",
          text: "You grant us a worldwide, non-exclusive license to host, reproduce, transmit, modify solely as technically necessary, and process your Inputs only as necessary to provide, secure, maintain, and improve the Service, comply with law, and carry out the instructions you provide through the Service.",
        },
        {
          type: "p",
          text: "We do not use private Project Content to train a public or generally available foundation model unless you separately opt in. “Improve the Service” here means operate, debug, and secure it — not train a public model on your show.",
        },
        {
          type: "p",
          text: "We treat private Project Content as confidential information and do not intentionally disclose it except to personnel and service providers who need it to provide or secure the Service, as directed by you, or as required by law. We do not automatically call every project a trade secret.",
        },
      ],
    },
    {
      id: "outputs",
      title: "10. AI Outputs",
      blocks: [
        {
          type: "p",
          text: "Subject to applicable law and any third-party model terms that necessarily apply to a generation, as between you and us, we do not claim ownership of the Outputs generated for your private projects. To the extent we obtain any transferable right in an Output solely through providing the Service, we assign that right to you upon creation, subject to payment of applicable fees and these Terms.",
        },
        {
          type: "p",
          text: "We do not guarantee that an Output is unique, copyrightable, non-infringing, or eligible for intellectual-property protection in every jurisdiction. Prompting alone does not automatically make the resulting material copyrightable. You control your project and the rights we can transfer to you, but copyright status depends on applicable law and the human authorship involved.",
        },
        {
          type: "p",
          text: "AI outputs may be similar to outputs generated for other users. Synthetic voices are generated from learned model characteristics and may coincidentally resemble existing voices. We do not guarantee that a Voice Design output is globally unique.",
        },
        {
          type: "p",
          text: "You are responsible for complying with any laws, platform rules, disclosure, labeling, provenance, or advertising requirements applicable to the way you publish or commercially use generated content.",
        },
      ],
    },
    {
      id: "voice",
      title: "11. Voice, likeness and real-person content",
      blocks: [
        {
          type: "p",
          text: "The Service may create fictional synthetic voices based on descriptive characteristics. We do not guarantee that a generated voice is unique or that it cannot coincidentally resemble a real person.",
        },
        {
          type: "p",
          text: "You may only upload or use a real person’s voice, face, image, likeness, or performance where you have all legally required rights and permissions. Face-photo actor packs require a recorded likeness-rights confirmation before generation starts. Real-person voice cloning and custom cloning of public figures are not offered.",
        },
      ],
    },
    {
      id: "model-terms",
      title: "12. Third-party model terms",
      blocks: [
        {
          type: "p",
          text: "Certain AI models are supplied by third-party model providers and may be subject to provider-specific restrictions. You agree not to use the Service in a manner that would cause us or you to violate an applicable model-provider restriction. We will not ask you to read every upstream term. We are responsible for enabling only models compatible with the intended use of this product.",
        },
      ],
    },
    {
      id: "aup",
      title: "13. Acceptable use",
      blocks: [
        {
          type: "p",
          text: "You must follow the Acceptable Use Policy. Fictional dramatic conflict is allowed. Unlawful, exploitative, or deceptive use is not.",
        },
      ],
    },
    {
      id: "copyright",
      title: "14. Copyright complaints",
      blocks: [
        {
          type: "p",
          text: `See /legal/copyright. Contact ${copyright}. This is a copyright and intellectual-property complaint process. It is not labeled a global DMCA process unless counsel later implements one.`,
        },
      ],
    },
    {
      id: "availability",
      title: "15. Service availability and changes",
      blocks: [
        {
          type: "p",
          text: "The Service may be interrupted. Models, routes, and features change. If a preferred private endpoint is unavailable, Standard profile jobs may use only another approved route. We do not silently send a job to an unapproved provider.",
        },
      ],
    },
    {
      id: "termination",
      title: "16. Suspension and termination",
      blocks: [
        {
          type: "p",
          text: "You may cancel and request account deletion. We may suspend an account for abuse, to comply with model-provider or legal restrictions, or for nonpayment under a clear policy. For serious creators we will provide a reasonable export opportunity unless the content is illegal, there is a security emergency, a provider or legal order, or nonpayment under that policy. We do not claim a right to delete your show for any reason with no notice.",
        },
      ],
    },
    {
      id: "disclaimers",
      title: "17. Disclaimers",
      blocks: [
        {
          type: "p",
          text: "The Service is provided as is, to the fullest extent permitted by law. We disclaim implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant uninterrupted or error-free operation, or that Outputs will be unique or lawful for every use you choose.",
        },
      ],
    },
    {
      id: "liability",
      title: "18. Limitation of liability",
      blocks: [
        {
          type: "p",
          text: "To the fullest extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, lost data, or failed productions beyond the fees you paid for the affected project in the twelve months before the claim. Mandatory consumer protections still apply where they cannot be waived.",
        },
      ],
    },
    {
      id: "indemnity",
      title: "19. Indemnity",
      blocks: [
        {
          type: "p",
          text: "You will defend and indemnify us against claims arising from your Inputs, your use of Outputs, your lack of rights in a voice or likeness, or your violation of these Terms or applicable law, except to the extent caused by our willful misconduct.",
        },
      ],
    },
    {
      id: "law",
      title: "20. Governing law and disputes",
      blocks: [
        {
          type: "p",
          text: `Governing law and dispute forum: ${displayField(LEGAL_ENTITY.governing_law, "[GOVERNING_LAW]")} / ${displayField(LEGAL_ENTITY.dispute_forum, "[COURTS / DISPUTE FORUM]")}. These placeholders are not a published court or arbitration clause. UAE counsel must choose the clause, including any mandatory consumer carve-outs. We will not casually copy a U.S. vendor arbitration clause.`,
        },
      ],
    },
    {
      id: "changes",
      title: "21. Changes",
      blocks: [
        {
          type: "p",
          text: "We may update these Terms. Material changes that require re-acceptance will be recorded against the new document version. The current version is shown at the top of this page.",
        },
      ],
    },
    {
      id: "contact",
      title: "22. Contact",
      blocks: [
        { type: "p", text: `Legal: ${legal}.` },
      ],
    },
  ],
};
