import { aiProcessingDocument } from "../../../src/legal/docs/ai-processing.ts";
import { LegalArticle } from "../LegalArticle.tsx";

export default function Page() {
  return <LegalArticle document={aiProcessingDocument} />;
}
