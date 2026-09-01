import type { LegalDocument } from "../document.ts";
import { acceptableUseDocument } from "./acceptable-use.ts";
import { aiProcessingDocument } from "./ai-processing.ts";
import { cookiesDocument } from "./cookies.ts";
import { copyrightDocument } from "./copyright.ts";
import { dataResidencyDocument } from "./data-residency.ts";
import { dpaDocument } from "./dpa.ts";
import { privacyDocument } from "./privacy.ts";
import { securityDocument } from "./security.ts";
import { termsDocument } from "./terms.ts";

export const LEGAL_DOCUMENTS: LegalDocument[] = [
  privacyDocument,
  termsDocument,
  aiProcessingDocument,
  acceptableUseDocument,
  cookiesDocument,
  copyrightDocument,
  dpaDocument,
  securityDocument,
  dataResidencyDocument,
];

export function documentBySlug(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((doc) => doc.slug === slug);
}

export {
  acceptableUseDocument,
  aiProcessingDocument,
  cookiesDocument,
  copyrightDocument,
  dataResidencyDocument,
  dpaDocument,
  privacyDocument,
  securityDocument,
  termsDocument,
};
