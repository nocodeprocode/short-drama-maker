import { describe, expect, it } from "vitest";
import { likelyForeignScript, readScriptFile } from "./commission-files.ts";

describe("commission files", () => {
  it("reads a plain-text script and rejects a document filename", async () => {
    const ok = new File(["A hospital heir finds a second ledger in the study. Episode 1 ends on the photograph."], "draft.txt", {
      type: "text/plain",
    });
    await expect(readScriptFile(ok)).resolves.toMatch(/hospital heir/);
    const docx = new File(["pk"], "剧本.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    await expect(readScriptFile(docx)).rejects.toThrow(/Save the script as \.txt/);
  });

  it("treats a long CJK paste as a foreign script", () => {
    const chinese = "她在丈夫书房里发现了第二本账。".repeat(20);
    expect(likelyForeignScript(chinese)).toBe(true);
    expect(likelyForeignScript("A quiet florist is recognized by a dying CEO as the daughter he hid.")).toBe(false);
  });
});
