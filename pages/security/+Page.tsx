import { securityDocument } from "../../src/legal/docs/security.ts";
import { LegalArticle } from "../legal/LegalArticle.tsx";

export default function Page() {
  return <LegalArticle document={securityDocument} />;
}
