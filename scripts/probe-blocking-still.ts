/**
 * Pre-flight for the blocking-still fix.
 *
 * The image client can now send more than one input_reference, but nothing
 * proves seedream honours a second one. This generates a location plate, then
 * composites a locked CU face into it at three framings, and asks the vision
 * model whether the face survived and whether the room matches the plate.
 *
 * If same_person collapses, the whole blocking-still approach is wrong and the
 * fallback (plate as single seed, character described in text) is next.
 *
 *   tsx scripts/probe-blocking-still.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const { createOpenRouterImages } = await import("../src/engine/ai/images.ts");
const { createOpenRouterVision } = await import("../src/engine/ai/vision.ts");
const { costMeter } = await import("../src/engine/ai/meter.ts");

const OUT = resolve(process.cwd(), "assets/probe-blocking");
const FACE = resolve(process.cwd(), "assets/drama-pro-cu-mara-voss.png");

const LOCATION = "Corner office at night — floor-to-ceiling windows, city lights below, dark walnut desk, single warm desk lamp";
const CHARACTER = "Mara Voss";
const APPEARANCE = "woman in her late thirties, dark hair pulled back, charcoal blazer over a high-neck top";

const FRAMINGS = [
  { id: "cu", text: "Tight head-and-shoulders close-up, face fills the frame, the room soft behind her" },
  { id: "mcu", text: "Medium close-up from the chest up, more of the room visible behind her" },
  { id: "reaction", text: "Medium close-up, she is turned three-quarters away and listening, not speaking" },
];

const ROOM_RUBRIC = `You compare a generated film frame against the location plate it was supposed to reuse.
Answer only with JSON: {"same_room": <0..1>, "notes": "<one sentence>"}.
same_room: 1.0 = unmistakably the same room, same wall colour, same window layout, same key light direction and colour. 0.5 = similar kind of room but details moved. 0.0 = a different place.
Judge geography and light only. Ignore the person, the camera angle and how much of the room is visible.`;

async function judgeRoom(frame: Uint8Array, plate: Uint8Array): Promise<{ same_room: number; notes: string }> {
  const { openRouterJson, openRouterProvider } = await import("../src/engine/ai/openrouter.ts");
  const { VISION_MODEL } = await import("../src/engine/config/models.ts");
  const { imageDataUrl } = await import("../src/engine/media/image-mime.ts");
  const url = (b: Uint8Array) => imageDataUrl(b);
  const body = await openRouterJson<{ choices?: Array<{ message?: { content?: string } }> }>(
    "/chat/completions",
    {
      method: "POST",
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        provider: openRouterProvider("text"),
        messages: [
          { role: "system", content: ROOM_RUBRIC },
          {
            role: "user",
            content: [
              { type: "text", text: "First image is the location plate. Second is the generated frame." },
              { type: "image_url", image_url: { url: url(plate) } },
              { type: "image_url", image_url: { url: url(frame) } },
            ],
          },
        ],
      }),
    },
    { idempotent: true },
  );
  const content = body.choices?.[0]?.message?.content ?? "{}";
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const raw = JSON.parse(trimmed) as Record<string, unknown>;
  return {
    same_room: typeof raw.same_room === "number" ? raw.same_room : Number(raw.same_room) || 0,
    notes: typeof raw.notes === "string" ? raw.notes : "",
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const images = createOpenRouterImages();
  const vision = createOpenRouterVision();

  const { honestImageMime } = await import("../src/engine/media/image-mime.ts");
  const face = new Uint8Array(readFileSync(FACE));
  console.log(`face still: ${FACE} (${face.byteLength} bytes, ${honestImageMime(face, "image/png")})`);

  const platePath = resolve(OUT, "plate.png");
  let plate: { bytes: Uint8Array; mime_type: string };
  if (existsSync(platePath)) {
    const bytes = new Uint8Array(readFileSync(platePath));
    plate = { bytes, mime_type: honestImageMime(bytes, "image/png") };
    console.log(`\n[1/3] reusing location plate (${plate.mime_type}, ${plate.bytes.byteLength} bytes)`);
  } else {
    console.log("\n[1/3] generating location plate...");
    plate = await images.generateReference({
      characterName: LOCATION,
      description: LOCATION,
      kind: "location",
    });
    writeFileSync(platePath, plate.bytes);
    console.log(`  plate written as ${plate.mime_type}`);
  }
  const notes = await vision.describeLocation!({ plate: plate.bytes, plateMime: plate.mime_type, location: LOCATION });
  console.log(`  people_present=${notes.people_present}`);
  console.log(`  lighting_lock: ${notes.lighting_lock}`);

  console.log("\n[2/3] compositing blocking stills (2 refs each)...");
  const results: Array<Record<string, unknown>> = [];
  for (const framing of FRAMINGS) {
    process.stdout.write(`  ${framing.id}... `);
    let out;
    try {
      out = await images.generateBlockingStill!({
        characterName: CHARACTER,
        description: APPEARANCE,
        framing: framing.text,
        locationNote: notes.lighting_lock,
        face_bytes: face,
        face_mime_type: "image/png",
        plate_bytes: plate.bytes,
        plate_mime_type: plate.mime_type,
      });
    } catch (error) {
      console.log(`FAILED: ${(error as Error).message}`);
      results.push({ framing: framing.id, error: (error as Error).message });
      continue;
    }
    const path = resolve(OUT, `blocking-${framing.id}.png`);
    writeFileSync(path, out.bytes);

    const id = await vision.judgeIdentity({
      reference: face,
      frames: [out.bytes],
      frameMime: out.mime_type,
      expectedFaces: 1,
      description: APPEARANCE,
    });
    const room = await judgeRoom(out.bytes, plate.bytes);
    console.log(`same_person=${id.same_person.toFixed(2)} faces=${id.face_count} same_room=${room.same_room.toFixed(2)}`);
    console.log(`      id: ${id.notes}`);
    console.log(`      room: ${room.notes}`);
    results.push({
      framing: framing.id,
      path,
      same_person: id.same_person,
      face_count: id.face_count,
      same_room: room.same_room,
      id_notes: id.notes,
      room_notes: room.notes,
    });
  }

  console.log("\n[3/3] verdict");
  const ok = results.filter(
    (r) => typeof r.same_person === "number" && (r.same_person as number) >= 0.7 && (r.same_room as number) >= 0.7 && r.face_count === 1,
  );
  const verdict = ok.length >= 2 ? "PASS" : "FAIL";
  console.log(`  ${ok.length}/${FRAMINGS.length} framings kept both face and room -> ${verdict}`);
  if (verdict === "FAIL") {
    console.log("  Two-reference compositing is not reliable. Fall back to single-seed (plate as seed).");
  }
  const spend = costMeter.peek();
  console.log(`  spend: $${spend.toFixed(4)}`);

  writeFileSync(
    resolve(OUT, "report.json"),
    JSON.stringify({ verdict, lighting_lock: notes.lighting_lock, spend, results }, null, 2),
  );
  console.log(`  report: ${resolve(OUT, "report.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
