import { dataResidencyDocument } from "../../../src/legal/docs/data-residency.ts";
import { LegalArticle } from "../LegalArticle.tsx";

export default function Page() {
  return <LegalArticle document={dataResidencyDocument} />;
}
