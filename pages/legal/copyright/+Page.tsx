import { copyrightDocument } from "../../../src/legal/docs/copyright.ts";
import { LegalArticle } from "../LegalArticle.tsx";

export default function Page() {
  return <LegalArticle document={copyrightDocument} />;
}
