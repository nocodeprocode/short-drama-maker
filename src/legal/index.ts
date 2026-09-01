export { LEGAL_ENTITY, isLegalIdentityComplete, operatorLine } from "./entity.ts";
export {
  COMPANY_PRIVACY_POLICY,
  DOCUMENT_VERSIONS,
  FOOTER_LINKS,
} from "./policy.ts";
export {
  AI_PROVIDER_ROUTES,
  INFRASTRUCTURE_PROVIDERS,
  PrivacyRouteUnavailableError,
  assertStrictAvailable,
  generationPrivacyLog,
} from "./providers.ts";
export { documentBySlug, LEGAL_DOCUMENTS } from "./docs/index.ts";
export type { LegalDocument } from "./document.ts";
