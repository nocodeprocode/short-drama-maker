import { privacyDocument } from "../../../src/legal/docs/privacy.ts";
import { LegalArticle } from "../LegalArticle.tsx";

export default function Page() {
  return <LegalArticle document={privacyDocument} />;
}
