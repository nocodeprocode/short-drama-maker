import { cookiesDocument } from "../../../src/legal/docs/cookies.ts";
import { LegalArticle } from "../LegalArticle.tsx";

export default function Page() {
  return <LegalArticle document={cookiesDocument} />;
}
