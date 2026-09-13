const SCRIPT_MAX = 80_000;

export async function readScriptFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx") || name.endsWith(".pdf") || name.endsWith(".doc")) {
    throw new Error("Save the script as .txt, or paste it.");
  }
  const text = (await file.text()).replace(/\u0000/g, "").trim();
  if (text.length < 40) throw new Error("That file is empty or too short.");
  if (looksBinary(text)) throw new Error("Use a .txt script, or paste the text.");
  return text.slice(0, SCRIPT_MAX);
}

export function likelyForeignScript(text: string) {
  const cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) ?? []).length;
  return text.length > 200 && cjk / text.length > 0.12;
}

function looksBinary(text: string) {
  const sample = text.slice(0, 800);
  let odd = 0;
  for (const char of sample) {
    const code = char.charCodeAt(0);
    if (code < 9 || (code > 13 && code < 32)) odd += 1;
  }
  return odd > 8;
}
