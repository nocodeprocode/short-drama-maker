import { termsDocument } from "../../../src/legal/docs/terms.ts";
import { LegalArticle } from "../LegalArticle.tsx";

export default function Page() {
  return <LegalArticle document={termsDocument} />;
}
