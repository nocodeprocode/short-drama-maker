import { acceptableUseDocument } from "../../../src/legal/docs/acceptable-use.ts";
import { LegalArticle } from "../LegalArticle.tsx";

export default function Page() {
  return <LegalArticle document={acceptableUseDocument} />;
}
