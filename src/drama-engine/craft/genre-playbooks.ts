import type { GenreId, GenrePlaybook } from "../types/genre.ts";

export const GENRE_PLAYBOOKS: Record<GenreId, GenrePlaybook> = {
  billionaire: {
    id: "billionaire",
    title: "Billionaire / CEO / contract / hidden heiress",
    premiseTemplate:
      "{broke_or_hidden woman} is bound by {contract/fake marriage/job} to {CEO}; the room believes she is disposable; evidence inverts status in public.",
    storyDirection: "contract",
    requiredArchetypes: [
      { job: "engine", role: "contract wife / secretary" },
      { job: "wall", role: "CEO" },
      { job: "witness", role: "lawyer or assistant" },
      { job: "nuke", role: "hidden heir / leaked NDA" },
    ],
    visualMotifs: ["glass office", "penthouse rain", "ring box", "NDA", "black car"],
    setPieces: ["signing table", "elevator", "gala", "board vote", "hospital corridor"],
    cliffPatterns: ["identity", "humiliation", "choice", "interruption"],
    punish: [
      "soft rom-com pace",
      "CEO kind with no cost",
      "no public release",
      "son-in-law humiliation",
    ],
    skuPolicy: ["en_iap"],
    tenBeats: [
      "Public humiliation / contract signing",
      "Forced proximity rule",
      "Accidental competence reveal",
      "Rival/ex plants shame",
      "E5 reprice — he’s using her or she’s the heir",
      "A confession is interrupted",
      "Pregnancy/heir math or leaked contract",
      "Banquet counter-shame (planted receipt)",
      "Choice: love vs name",
      "Public choosing + leftover twin/board nuke",
    ],
  },
  werewolf: {
    id: "werewolf",
    title: "Werewolf / fated mate / pack",
    premiseTemplate:
      "{low-status wolf/human} is {rejected/mated} to {Alpha who hates her}; she is secretly {Luna/hybrid/heir}; pack law makes love political.",
    storyDirection: "hidden_identity",
    requiredArchetypes: [
      { job: "engine", role: "omega / servant" },
      { job: "wall", role: "Alpha" },
      { job: "witness", role: "Beta" },
      { job: "nuke", role: "true-mate mark / kidnapped Luna" },
    ],
    visualMotifs: ["black envelope", "brass lamp", "private office", "wrist mark", "wet courier jacket"],
    setPieces: ["private office claim", "forced hire", "pack house study", "hospital bill"],
    cliffPatterns: ["identity", "romantic", "danger", "humiliation"],
    punish: [
      "lore dumps",
      "no visible hierarchy",
      "just a guy in contacts",
      "gore without romance contract",
      "I2V creature morph",
      "on-camera transformation",
      "body changing into a wolf",
      "claiming bite on camera",
    ],
    skuPolicy: ["en_iap"],
    tenBeats: [
      "Rejection ceremony",
      "Scent/bond hit she cannot control",
      "Servitude + rival she-wolf",
      "One private tell — a human face changes for one beat, never a body change",
      "True mate is a second Alpha (triangle)",
      "Mark almost spoken, never bitten on camera",
      "Identity as kidnapped Luna",
      "Pack challenge",
      "Exile vs crown",
      "Public claim + leftover rogue king",
    ],
  },
  revenge: {
    id: "revenge",
    title: "Revenge / you will regret this",
    premiseTemplate:
      "{humiliated lead} keeps a ledger; each cluster pays one debt in public and adds a worse one.",
    storyDirection: "revenge",
    requiredArchetypes: [
      { job: "engine", role: "ledger keeper" },
      { job: "wall", role: "original villain" },
      { job: "witness", role: "public room that cannot leave" },
      { job: "nuke", role: "unfinished name on the ledger" },
    ],
    visualMotifs: ["receipts", "vow catchphrase"],
    setPieces: ["wedding", "board", "pack original crime"],
    cliffPatterns: ["humiliation", "information", "danger"],
    punish: ["only hurt, no slap-back", "violent blood revenge", "NRTA violent revenge"],
    skuPolicy: ["en_iap"],
    tenBeats: [
      "Original crime",
      "Vow (catchphrase)",
      "First small receipt",
      "Comfort ally",
      "Bigger threat / they try to erase her",
      "Mid ledger reveal to audience",
      "Ally betrayal",
      "Public crush of villain",
      "Cost of revenge (she becomes Wall)",
      "Final name + unfinished name",
    ],
  },
  hidden_identity: {
    id: "hidden_identity",
    title: "Hidden identity / secret baby / amnesia",
    premiseTemplate: "One fact relabels everyone. Baby is a timer + DNA insert, not a prop.",
    storyDirection: "secret_child",
    requiredArchetypes: [
      { job: "engine", role: "nobody who is somebody" },
      { job: "wall", role: "the person who should have known" },
      { job: "witness", role: "doctor / lawyer / nanny" },
      { job: "nuke", role: "test / locket / DNA sheet" },
    ],
    visualMotifs: ["DNA insert", "lock-screen", "locket"],
    setPieces: ["hospital corridor", "banquet naming"],
    cliffPatterns: ["identity", "information", "choice"],
    punish: ["encyclopedia after reveal", "baby with no clock", "confusing flashback"],
    skuPolicy: ["en_iap"],
    tenBeats: [
      "Humiliation of nobody",
      "Object planted",
      "Near-reveal interrupted",
      "Amnesia or they hide the child",
      "Hospital",
      "DNA",
      "Public naming",
      "Custody choice cliff",
      "Comfort that costs",
      "Unpaid twin / second parent",
    ],
  },
  mafia: {
    id: "mafia",
    title: "Mafia / dark romance",
    premiseTemplate:
      "{innocent or debt courier} is claimed by {don}; love is a protection racket.",
    storyDirection: "hidden_identity",
    requiredArchetypes: [
      { job: "engine", role: "debt / innocent" },
      { job: "wall", role: "don with a code" },
      { job: "witness", role: "driver or priest" },
      { job: "nuke", role: "rival family / blood choice" },
    ],
    visualMotifs: ["tattoos", "gun implied off-frame"],
    setPieces: ["car back seat", "warehouse", "church"],
    cliffPatterns: ["danger", "romantic", "choice", "interruption"],
    punish: ["cartoon gore without erotic contract", "hero with no code", "on-camera guns"],
    skuPolicy: ["en_iap"],
    tenBeats: [
      "Abduction / debt",
      "Safehouse forced intimacy",
      "Rival family",
      "You’re mine public",
      "Almost escape",
      "Betrayal",
      "Blood choice",
      "Crown or grave",
      "Cost of protection",
      "Leftover rival king",
    ],
  },
  rebirth: {
    id: "rebirth",
    title: "Time travel / rebirth / 后悔流",
    premiseTemplate:
      "Death/crash → wake at a dated node with a ledger of future harms. First eps spend foreknowledge as a weapon.",
    storyDirection: "second_chance",
    requiredArchetypes: [
      { job: "engine", role: "reborn with the ledger" },
      { job: "wall", role: "the person who will harm her" },
      { job: "witness", role: "the one who died last life" },
      { job: "nuke", role: "crisis this life did not have" },
    ],
    visualMotifs: ["dated newspaper labeled LAST LIFE", "one timeline on screen"],
    setPieces: ["wake node", "memory cluster"],
    cliffPatterns: ["information", "interruption", "identity"],
    punish: ["confusing flashback", "unlabeled last-life insert", "complex intercut"],
    skuPolicy: ["en_iap", "cn_iaa"],
    tenBeats: [
      "Death (E1–3)",
      "Wake at dated node",
      "Deconstruct present",
      "Memory cluster E4–8",
      "First rewrite that costs",
      "Plan starts E9+",
      "Ally from last life",
      "Crisis this life did not have",
      "Public proof she knew",
      "Unpaid future name",
    ],
  },
  workplace_cinderella: {
    id: "workplace_cinderella",
    title: "Cinderella workplace",
    premiseTemplate:
      "Maid / intern / cleaner × power. Class-crossover + public choosing. Friction must be filmable.",
    storyDirection: "contract",
    requiredArchetypes: [
      { job: "engine", role: "invisible labor" },
      { job: "wall", role: "the executive" },
      { job: "witness", role: "the room that ignored her" },
      { job: "nuke", role: "she’s the owner / she wrote the clause" },
    ],
    visualMotifs: ["wrong badge", "uninvited gala"],
    setPieces: ["meeting without her", "you’re fired / you’re the owner"],
    cliffPatterns: ["humiliation", "identity", "choice"],
    punish: ["HR realism", "slow promotion plot", "procedure porn"],
    skuPolicy: ["en_iap"],
    tenBeats: [
      "Public invisibility",
      "Filmable constraint (badge won’t scan)",
      "Competence in the wrong room",
      "Rival plants HR shame",
      "E5 she’s the buyer / heir",
      "Almost-soft moment interrupted",
      "Fired on the record",
      "Gala she wasn’t invited to",
      "Public choosing",
      "Board leftover nuke",
    ],
  },
  legal_medical: {
    id: "legal_medical",
    title: "Lawyer / doctor power fantasy",
    premiseTemplate:
      "The rulebook is on screen before the flip. Doctor who is the hospital buyer; lawyer who wrote the clause.",
    storyDirection: "family_secret",
    requiredArchetypes: [
      { job: "engine", role: "underestimated specialist" },
      { job: "wall", role: "the institution" },
      { job: "witness", role: "patient / client in the room" },
      { job: "nuke", role: "the clause / the deed" },
    ],
    visualMotifs: ["chart / contract insert readable in 2s"],
    setPieces: ["gallery", "OR doorway"],
    cliffPatterns: ["information", "humiliation", "identity"],
    punish: ["jargon without a room flip", "procedure porn"],
    skuPolicy: ["en_iap"],
    tenBeats: [
      "Public dismiss",
      "Rulebook on screen",
      "First save that looks like luck",
      "Institution tries to bury it",
      "E5 she wrote the clause",
      "Almost-reveal interrupted",
      "Witness trapped in the room",
      "Public flip",
      "Cost of winning",
      "Unpaid second clause",
    ],
  },
  costume: {
    id: "costume",
    title: "Costume / period status flip",
    premiseTemplate:
      "A locked-era room (court, clan hall, treaty table) treats the lead as disposable until a seal, edict, or blood token inverts rank in public.",
    storyDirection: "hidden_identity",
    requiredArchetypes: [
      { job: "engine", role: "discarded bride / servant" },
      { job: "wall", role: "prince / clan head" },
      { job: "witness", role: "court that laughed" },
      { job: "nuke", role: "edict / jade token / hidden bloodline" },
    ],
    visualMotifs: ["seal", "edict", "lantern hall"],
    setPieces: ["banquet", "ancestral hall", "city gate"],
    cliffPatterns: ["identity", "humiliation", "choice"],
    punish: ["tour-guide lore", "soft palace romance with no public cost"],
    skuPolicy: ["en_iap", "cn_iaa"],
    tenBeats: [
      "Public discard",
      "Forced proximity rule of the house",
      "Competence the court cannot ignore",
      "Rival plants shame",
      "E5 the token is hers",
      "Almost-reveal interrupted",
      "Exile threat",
      "Banquet counter-shame",
      "Public choosing",
      "Leftover clan nuke",
    ],
  },
};

export const STORY_DIRECTION_TO_GENRE: Record<string, GenreId> = {
  contract: "billionaire",
  secret_child: "hidden_identity",
  revenge: "revenge",
  hidden_identity: "hidden_identity",
  second_chance: "rebirth",
  family_secret: "legal_medical",
  amnesia: "hidden_identity",
  werewolf: "werewolf",
  mafia: "mafia",
  workplace: "workplace_cinderella",
};

export function playbookFor(id: GenreId): GenrePlaybook {
  return GENRE_PLAYBOOKS[id];
}

export function inferGenre(text: string): GenreId {
  const hay = text.toLowerCase();
  if (/\b(wolf|luna|alpha|pack|mate)\b/.test(hay)) return "werewolf";
  if (/\b(mafia|don|cartel)\b/.test(hay)) return "mafia";
  if (/\b(reborn|rebirth|second chance|last life)\b/.test(hay)) return "rebirth";
  if (/\b(revenge|regret this|you will pay)\b/.test(hay)) return "revenge";
  if (/\b(intern|badge|office|ceo secretary|cleaner)\b/.test(hay)) return "workplace_cinderella";
  if (/\b(lawyer|doctor|clause|hospital)\b/.test(hay)) return "legal_medical";
  if (/\b(dynasty|empress|edict|palace)\b/.test(hay)) return "costume";
  if (/\b(secret|hidden|dna|amnesia|baby)\b/.test(hay)) return "hidden_identity";
  return "billionaire";
}

export function punishAllowed(playbook: GenrePlaybook, skuPolicy: string, trope: string): boolean {
  const needle = trope.toLowerCase();
  if (skuPolicy === "cn_iaa" && playbook.id === "revenge") {
    if (/\b(blood|violent|slap|gore|kill)\b/.test(needle)) return false;
  }
  if (skuPolicy === "cn_iaa" && playbook.id === "mafia") {
    if (/\b(gore|gun|blood)\b/.test(needle)) return false;
  }
  return !playbook.punish.some((item) => needle.includes(item.toLowerCase()));
}
