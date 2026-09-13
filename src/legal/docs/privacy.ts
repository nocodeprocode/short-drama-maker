import { DOCUMENT_DATES, DOCUMENT_VERSIONS } from "../policy.ts";
import { displayField, LEGAL_ENTITY, operatorLine } from "../entity.ts";
import type { LegalDocument } from "../document.ts";

const privacy = displayField(LEGAL_ENTITY.privacy_email, "[PRIVACY_EMAIL]");
const support = displayField(LEGAL_ENTITY.support_email, "[SUPPORT_EMAIL]");

export const privacyDocument: LegalDocument = {
  slug: "privacy",
  title: "Privacy Policy",
  version: DOCUMENT_VERSIONS.privacy,
  effective: DOCUMENT_DATES.effective,
  updated: DOCUMENT_DATES.updated,
  summary:
    "Your projects are private by default. We store the content needed to operate your projects and send only the information needed for a requested AI operation to our approved AI processors. We use OpenRouter as our primary AI gateway and may use specialist providers directly for features such as synthetic voice creation. Provider and data-location information is maintained on our AI Processing page. We do not sell your project content.",
  counsel_note:
    "This is a product draft aligned to current engineering. It is not a substitute for UAE counsel review, or EEA/UK privacy counsel if those markets are served.",
  sections: [
    {
      id: "who",
      title: "1. Who we are",
      blocks: [
        { type: "p", text: operatorLine() },
        {
          type: "p",
          text: `Registered address: ${displayField(LEGAL_ENTITY.registered_address, "[REGISTERED_ADDRESS]")}. Legal form: ${displayField(LEGAL_ENTITY.legal_form, "[LEGAL_FORM]")}.`,
        },
        {
          type: "p",
          text: "Until the legal-entity fields above are completed, this Policy is an internal draft and is not a public launch statement.",
        },
      ],
    },
    {
      id: "scope",
      title: "2. Scope",
      blocks: [
        {
          type: "p",
          text: "This Policy describes how we process personal information and project content when you use Takehaus (the “Service”). It applies to consumer creator accounts. If a studio or other business customer uploads third-party personal data, that customer is typically the controller of that data and we act as its processor under a Data Processing Addendum.",
        },
      ],
    },
    {
      id: "collect",
      title: "3. Information we collect",
      blocks: [
        {
          type: "p",
          text: "Account information. Name, email, authentication identifiers, organization membership, and account settings. We use this to create and operate the account, authenticate you, communicate with you, and secure the Service.",
        },
        {
          type: "p",
          text: "Project Content. When you create or upload a project, we process the text, images, audio, video, character information, prompts, references, and other material that you provide or generate through the Service. We use Project Content to provide the requested creation, editing, storage, rendering, and AI-generation functions. Project Content is private by default unless you expressly publish or share it. We do not create public galleries by default.",
        },
        {
          type: "p",
          text: "AI-generated content. Generated images, speech, video, scripts, captions, storyboards, and finished episodes may be produced and temporarily delivered by third-party model providers before we copy the result into our storage. Our systems are the source of truth for your show. Provider output URLs are transport, not permanent storage.",
        },
        {
          type: "p",
          text: "Usage and device information. IP address, device type, browser, operating system, timestamps, request metadata, login and security events, error logs, feature usage, and an approximate region inferred from IP. We may use an IP-derived approximate location to operate, secure, localize, or route the Service. We do not require precise device location for core operation.",
        },
        {
          type: "p",
          text: "Payments. Purchases may be processed by a Merchant of Record. We receive transaction and entitlement information required to activate and administer the Service. We do not need to store full payment-card numbers. The Merchant of Record, once designated, is listed on the AI Processing & Subprocessors page as a payment and merchant-of-record provider.",
        },
        {
          type: "p",
          text: `Communications. Support messages, feedback, bug reports, attachments you send to support, and marketing preferences if you later opt in. Contact: ${support}.`,
        },
      ],
    },
    {
      id: "use",
      title: "4. How we use information",
      blocks: [
        {
          type: "ul",
          items: [
            "Provide, maintain, and secure the Service.",
            "Generate, store, and assemble the productions you request.",
            "Authenticate you, prevent abuse, and investigate security incidents.",
            "Process payments and keep legally required records.",
            "Respond to support and privacy requests.",
            "Comply with law and valid legal process.",
          ],
        },
        {
          type: "p",
          text: "We do not sell Project Content. We do not use private Project Content to train a public or generally available foundation model of our own.",
        },
      ],
    },
    {
      id: "ai",
      title: "5. AI processing",
      blocks: [
        {
          type: "p",
          text: "The Service uses artificial intelligence models provided by third parties. When you request an AI feature, we send the information necessary to complete that request to an AI gateway or model provider. Depending on the feature, this may include text, prompts, images, video, audio, voice references, character references, or other Project Content.",
        },
        {
          type: "p",
          text: "We currently use OpenRouter as a primary AI inference gateway. OpenRouter may transmit the relevant input to the model provider selected for the request. We restrict the providers and endpoints our Service is permitted to use and apply data-retention and data-use controls where supported. We do not allow the gateway to send private project assets to an arbitrary cheaper provider.",
        },
        {
          type: "p",
          text: "We may also use certain AI providers directly where a capability is not available through OpenRouter, such as creating a persistent synthetic character voice with ElevenLabs.",
        },
        {
          type: "p",
          text: "The current providers, purposes, and available data-location information are listed on our AI Processing & Subprocessors page. Processing location varies by AI model and infrastructure provider. Where a specific processing region is not contractually or publicly confirmed, we do not represent that the processing is restricted to a particular country. Model origin (for example a Chinese-origin model) is not the same as the physical inference region.",
        },
        {
          type: "p",
          text: "The Service currently ships a Standard privacy profile only: content logging off at the gateway, zero-data-retention requested where the route supports it, data_collection deny preferred, and no fallbacks outside the approved list. A Strict regional-processing mode is not offered until we can enforce documented geography for the routes a production actually uses. Video generation is not treated as ZDR-eligible, because the provider must temporarily retain the file so we can download it.",
        },
      ],
    },
    {
      id: "bases",
      title: "6. Legal bases",
      blocks: [
        {
          type: "p",
          text: "If you are in the EEA or UK, we rely on these typical bases. This table is a draft for counsel, not a claim that every market has been assessed.",
        },
        {
          type: "table",
          headers: ["Processing", "Typical legal basis"],
          rows: [
            ["Account creation / authentication", "Contract"],
            ["Store projects / generate content", "Contract"],
            ["AI processing needed for a requested feature", "Contract"],
            ["Fraud / abuse / security logs", "Legitimate interests / legal obligation as applicable"],
            ["Transaction records", "Contract / legal obligation"],
            ["Optional marketing email", "Consent or another permitted basis"],
            ["Non-essential cookies", "Consent where required — we do not currently set them"],
            ["Customer support", "Contract / legitimate interests"],
            ["Compliance / lawful requests", "Legal obligation"],
          ],
        },
        {
          type: "p",
          text: "We do not treat consent as the basis for every core generation. For an uploaded face used as an actor reference, we collect an affirmative likeness-rights confirmation in addition to any other basis. That confirmation is stored with a document version. Voice cloning from an uploaded recording is not offered.",
        },
      ],
    },
    {
      id: "disclose",
      title: "7. How we disclose information",
      blocks: [
        {
          type: "p",
          text: "Service providers. Infrastructure such as Supabase and Cloudflare receive account, project, and media data as needed to host and secure the Service.",
        },
        {
          type: "p",
          text: "AI processors and model providers. OpenRouter and the approved model endpoint for a job, and ElevenLabs for voice features. We use the broader term “AI processors and model providers” rather than calling every model vendor a legal subprocessor of OpenRouter.",
        },
        {
          type: "p",
          text: "Merchant of Record. Transaction data, once a merchant is designated.",
        },
        {
          type: "p",
          text: "Legal, safety, and business transfers. We may preserve or disclose information where required by applicable law, valid legal process, or to protect rights, safety, and security, or in connection with a corporate transaction. We do not promise that we will always notify you; we notify unless legally prohibited, after legal review.",
        },
      ],
    },
    {
      id: "transfers",
      title: "8. International transfers",
      blocks: [
        {
          type: "p",
          text: "We and our service providers may process information in countries other than the country where you live. Account and project metadata for this deployment are stored in Supabase us-east-1 (North Virginia). AI inference often happens somewhere else. Being a UAE-operated product, if that is how the entity is formed, does not mean data physically remains in the UAE.",
        },
        {
          type: "p",
          text: "Where applicable law requires safeguards for international transfers — including UAE Federal Decree-Law No. 45 of 2021 and, for EEA users, GDPR Chapter V — we use contractual or other recognized transfer mechanisms where available and appropriate. Counsel must validate the final transfer mechanism before public launch.",
        },
      ],
    },
    {
      id: "likeness",
      title: "9. Voice, image and likeness information",
      blocks: [
        {
          type: "p",
          text: "Some features may process voice recordings, facial images, or other depictions of identifiable individuals. Depending on the feature and applicable law, this information may be treated as biometric, sensitive, or otherwise specially regulated data. We do not claim that every face image is legally biometric data, and we do not claim that none of it is.",
        },
        {
          type: "p",
          text: "The current product default is synthetic Voice Design from a text description of a fictional character. You may optionally upload a private face photo to generate an account-owned actor pack after a recorded likeness-rights confirmation. We do not support cloning a real person’s voice or a public figure’s likeness.",
        },
        {
          type: "p",
          text: "Project Content may contain information about individuals or fictional characters. We process it to provide the Service and do not treat fictional or contextual content as a verified personal attribute of the account holder.",
        },
      ],
    },
    {
      id: "retention",
      title: "10. Data retention",
      blocks: [
        {
          type: "p",
          text: "We keep Project Content while the account or project exists. We do not say that we “never retain your content.” Scripts, voices, shots, and finished episodes are stored so we can operate your show.",
        },
        {
          type: "ul",
          items: [
            "Selected shot generations and the last two unused candidates are kept with the project.",
            "Failed generations are queued for deletion after 7 days.",
            "Unselected intermediate media is queued for deletion after 30 days.",
            "A soft-deleted series is queued for full purge after 30 days.",
            "Security logs are designed for 30–90 days unless needed for abuse, claims, fraud, or investigations.",
            "Billing and tax records are kept as required by law.",
            "Legal acceptance records are kept for as long as needed to evidence the agreement.",
          ],
        },
        {
          type: "p",
          text: "Third-party AI processors may retain content according to the endpoint-specific terms disclosed on our AI Processing page. We configure zero-retention or no-training routes where supported. We do not promise instant deletion at every provider.",
        },
        {
          type: "p",
          text: "A complete account-deletion path (sessions revoked, assets purged, provider-side voices removed) is required before launch. Until that path is wired to production authentication, use the privacy request contact below rather than treating a UI button as a completed guarantee.",
        },
      ],
    },
    {
      id: "security",
      title: "11. Security",
      blocks: [
        {
          type: "p",
          text: "We use administrative, technical, and organizational safeguards designed to protect information, including access controls, private storage, encryption in transit, authentication controls, and restricted server-side provider credentials. No system can guarantee absolute security.",
        },
      ],
    },
    {
      id: "rights",
      title: "12. Your rights and choices",
      blocks: [
        {
          type: "p",
          text: `You may request access, download, correction, account deletion, objection or restriction where applicable, consent withdrawal, marketing opt-out, and portability where applicable. Use /privacy/request or email ${privacy}. We will identify and verify the requester before releasing data.`,
        },
        {
          type: "p",
          text: "Authorized personnel may access Project Content only where reasonably necessary to provide support, investigate security or abuse issues, comply with law, or maintain the Service.",
        },
      ],
    },
    {
      id: "cookies",
      title: "13. Cookies",
      blocks: [
        {
          type: "p",
          text: "The Service is designed to use strictly necessary cookies or equivalent storage for authentication, security, and load balancing. We do not currently set advertising or third-party behavioral cookies. See the Cookie Notice.",
        },
      ],
    },
    {
      id: "children",
      title: "14. Children",
      blocks: [
        {
          type: "p",
          text: "The Service is for users aged 18 and over, or the age of legal majority required to enter a binding agreement in your jurisdiction. We do not knowingly collect personal information from children.",
        },
      ],
    },
    {
      id: "b2b",
      title: "15. Business customers",
      blocks: [
        {
          type: "p",
          text: "If you use the Service as a studio or agency processing other people’s data, our Data Processing Addendum describes controller and processor roles. AI inference providers are called out there; they are not hidden under “cloud infrastructure.”",
        },
      ],
    },
    {
      id: "changes",
      title: "16. Changes",
      blocks: [
        {
          type: "p",
          text: "We may update this Policy. The version and last-updated date appear at the top. Material changes in how we process data may require notice. We do not treat every wording change as something that can be legalized only by forcing a new “I agree.”",
        },
      ],
    },
    {
      id: "contact",
      title: "17. Contact",
      blocks: [
        {
          type: "p",
          text: `Privacy: ${privacy}. Legal: ${displayField(LEGAL_ENTITY.legal_email, "[LEGAL_EMAIL]")}. Support: ${support}.`,
        },
      ],
    },
  ],
};
