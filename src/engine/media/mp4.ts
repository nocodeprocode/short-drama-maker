function box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(payload, 8);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function zeros(length: number): Uint8Array {
  return new Uint8Array(length);
}

/** Build a 9:16 ISO-BMFF container with a sound handler. */
export function buildPortraitMp4(durationSeconds = 4): Uint8Array {
  const timescale = 1000;
  const duration = Math.round(durationSeconds * timescale);
  const identity = concat(
    u32(0x00010000),
    zeros(12),
    u32(0x00010000),
    zeros(12),
    u32(0x40000000),
  );
  const mvhd = box(
    "mvhd",
    concat(
      u32(0),
      u32(0),
      u32(0),
      u32(timescale),
      u32(duration),
      u32(0x00010000),
      new Uint8Array([0x01, 0x00, 0x00, 0x00]),
      zeros(8),
      identity,
      zeros(24),
      u32(3),
    ),
  );
  const videoTkhd = box(
    "tkhd",
    concat(
      u32(0x00000003),
      u32(0),
      u32(0),
      u32(1),
      u32(0),
      u32(duration),
      zeros(8),
      u32(0),
      u32(0),
      identity,
      u32(1080 * 65536),
      u32(1920 * 65536),
    ),
  );
  const audioHdlr = box(
    "hdlr",
    concat(u32(0), u32(0), new TextEncoder().encode("soun"), zeros(12)),
  );
  const moov = box(
    "moov",
    concat(mvhd, box("trak", videoTkhd), box("trak", box("mdia", audioHdlr))),
  );
  return concat(
    box("ftyp", concat(new TextEncoder().encode("isom"), u32(0), new TextEncoder().encode("isom"))),
    moov,
    box("mdat", new Uint8Array(64)),
  );
}
