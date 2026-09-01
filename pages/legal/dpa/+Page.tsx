import { dpaDocument } from "../../../src/legal/docs/dpa.ts";
import { LegalArticle } from "../LegalArticle.tsx";

export default function Page() {
  return <LegalArticle document={dpaDocument} />;
}
