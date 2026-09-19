import { useEffect, useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { Image01 } from "@untitledui/icons";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { FileDrop } from "@/components/base/file-drop/file-drop";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/input/textarea";
import { RadioCard, RadioCardGroup } from "@/components/base/radio-card/radio-card.tsx";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import { AccountSkeleton, LoadError } from "@/components/drama/skeleton.tsx";
import { parseTags } from "@/components/drama/actor-form.tsx";
import { packTiles } from "@/lib/actor-pack.ts";
import { studio, type Actor, type ActorDetail } from "@/lib/api.ts";
import { prepareImageUpload } from "@/lib/image-upload.ts";
import { useStudio } from "@/lib/use-studio.ts";

function statusChip(actor: Pick<Actor, "status" | "progress" | "ready">): string {
  // Faces are built one at a time, so a queued pack has not started. Calling that
  // "Building" made an ordinary wait read as a stall.
  if (actor.status === "queued") return "Waiting its turn";
  if (actor.status === "running") {
    const done = actor.progress?.done ?? 0;
    const total = actor.progress?.total ?? 4;
    return done === 0 ? "Creating first portrait…" : `Building face pack · ${done}/${total}`;
  }
  if (actor.status === "failed") return "Needs attention";
  if (actor.ready) return "Ready";
  return "Casting";
}

function isBuilding(actor: Pick<Actor, "status">): boolean {
  return actor.status === "running" || actor.status === "queued";
}

/** Percent complete, or undefined before the first still lands. */
function packProgress(actor: Pick<Actor, "progress">): number | undefined {
  const done = actor.progress?.done ?? 0;
  const total = actor.progress?.total ?? 0;
  if (!total || done <= 0) return undefined;
  return Math.round((Math.min(done, total) / total) * 100);
}

export default function Page() {
  const id = usePageContext().routeParams.id;
  const { data: actor, error, reload, mutate } = useStudio(`actor:${id}`, () => studio.actor(id), [id]);
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [wardrobe, setWardrobe] = useState("");
  const [fidelity, setFidelity] = useState<"faithful" | "idealized">("faithful");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [likeness, setLikeness] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!actor) return;
    setName(actor.name);
    setTags(actor.tags.join(", "));
    setNotes(actor.notes || actor.description || "");
    setWardrobe(actor.default_wardrobe ?? "");
    setFidelity(actor.identity_fidelity === "idealized" ? "idealized" : "faithful");
  }, [actor]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (error && !actor) return <LoadError message={error} onRetry={() => void reload()} />;
  if (!actor) return <AccountSkeleton />;

  const locked = actor.appearances.some((row) => row.locked);

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      await studio.updateActor(id, {
        name,
        tags: parseTags(tags),
        notes,
        description: notes,
        default_wardrobe: wardrobe,
        identity_fidelity: fidelity,
      });
      await reload();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async (kinds?: string[]) => {
    setBusy(true);
    setSaveError(null);
    try {
      await studio.regenerateActor(id, { kinds });
      await reload();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Could not regenerate.");
    } finally {
      setBusy(false);
    }
  };

  const replacePhoto = async () => {
    if (!file) return;
    const previous = actor;
    setBusy(true);
    setSaveError(null);
    // The selected file is already local. Show it as the active seed now,
    // instead of making the buyer wait for upload, signing, and a reload.
    if (preview) {
      mutate({
        ...actor,
        seed_url: preview,
        still_url: preview,
        refs: [],
        ready: false,
        status: "queued",
        progress: { done: 0, total: 4 },
        judge_notes: null,
      });
    }
    try {
      const upload = await prepareImageUpload(file);
      const saved = await studio.replaceActorPhoto(id, {
        seed_base64: upload.base64,
        seed_mime_type: upload.mimeType,
        likeness_confirmed: likeness,
      });
      mutate((current) => current ? { ...current, ...saved } : current);
      setFile(null);
      setLikeness(false);
      void reload();
    } catch (caught) {
      mutate(previous);
      setSaveError(caught instanceof Error ? caught.message : "Could not replace the photo.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      await studio.deleteActor(id);
      window.location.href = "/actors";
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Could not remove this actor.");
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Actors"
        title={actor.name}
        subtitle={actor.source === "likeness" ? "From an uploaded face" : "Generated face"}
      />
      <PageBody>
        <div className="space-y-10">
          {saveError ? <p className="text-sm text-error-primary">{saveError}</p> : null}
          {actor.error ? <p className="text-sm text-error-primary">{actor.error}</p> : null}
          {actor.source === "likeness" && !actor.seed_url && actor.status === "failed" ? (
            <p className="text-sm text-tertiary">
              The original photo is still on the last attempt. Regenerate the pack to use it, or replace the photo.
            </p>
          ) : null}

          <section className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
            <div>
              <h2 className="text-sm font-semibold text-tertiary">Your upload</h2>
              <div className="mt-3 max-w-xs">
                <Poster
                  src={actor.seed_url}
                  title={actor.seed_url ? undefined : "No photo yet"}
                  chip={actor.seed_url ? "Uploaded" : "No photo"}
                  ratio="34"
                />
              </div>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-tertiary">Generated stills</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {packTiles(actor.refs).map((item) => (
                  <figure key={item.kind} className="min-w-0">
                    <Poster
                      src={item.url}
                      chip={item.url ? item.label : statusChip(actor)}
                      ratio="34"
                      working={!item.url && isBuilding(actor)}
                      progress={!item.url && isBuilding(actor) ? packProgress(actor) : undefined}
                    />
                    <figcaption className="mt-1.5 flex items-center justify-between gap-2 text-xs font-medium text-tertiary">
                      <span>{item.label}</span>
                      {locked || isBuilding(actor) ? null : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void regenerate([item.kind])}
                          className="cursor-pointer font-semibold text-brand-secondary hover:underline disabled:opacity-60"
                        >
                          {item.url ? "Redo" : "Generate"}
                        </button>
                      )}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>

          {actor.judge_notes ? (
            <p className="text-sm text-tertiary">We kept your face. {actor.judge_notes}</p>
          ) : null}

          <section className="max-w-xl space-y-4">
            <h2 className="text-lg font-semibold">Edit</h2>
            <Input label="Name" value={name} onChange={setName} isRequired />
            <Input label="Tags" value={tags} onChange={setTags} hint="Comma separated." />
            <TextArea label="Look notes" value={notes} onChange={setNotes} rows={3} />
            <Input label="Wardrobe" value={wardrobe} onChange={setWardrobe} placeholder="Closed jacket, buttoned shirt" />
            <RadioCardGroup
              label="How close to the photo"
              value={fidelity}
              onChange={(value) => setFidelity(value === "idealized" ? "idealized" : "faithful")}
              columns={2}
            >
              <RadioCard value="faithful" label="Keep my face" description="Professional stills of the uploaded person." />
              <RadioCard value="idealized" label="Idealized" description="Camera-ready beauty pass on top of the photo." />
            </RadioCardGroup>
            <Button color="primary" size="sm" isDisabled={busy || !name.trim()} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </section>

          <section className="max-w-xl space-y-4">
            <h2 className="text-lg font-semibold">Replace the photo</h2>
            <FileDrop
              label="New seed photo"
              accept="image/png,image/jpeg,image/webp"
              icon={Image01}
              title="Drop a photo or browse"
              subtitle="JPG, PNG, or WebP. This rebuilds the face pack."
              fileName={file?.name ?? null}
              previewUrl={preview}
              onFile={setFile}
              onClear={() => {
                setFile(null);
                setLikeness(false);
              }}
            />
            {file ? (
              <Checkbox
                isSelected={likeness}
                onChange={setLikeness}
                label="I confirm I have the rights to use this person's likeness for this account."
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                color="secondary"
                size="sm"
                isDisabled={busy || !file || !likeness || locked}
                onClick={() => void replacePhoto()}
              >
                Use this photo
              </Button>
              <Button color="secondary" size="sm" isDisabled={busy || locked} onClick={() => void regenerate()}>
                Regenerate the pack
              </Button>
              {locked ? null : (
                <Button color="tertiary" size="sm" isDisabled={busy} onClick={() => void remove()}>
                  Remove actor
                </Button>
              )}
            </div>
            {locked ? (
              <p className="text-sm text-tertiary">This face already shot. The stills stay locked for those shows.</p>
            ) : null}
          </section>

          <Appearances actor={actor} />
        </div>
      </PageBody>
    </>
  );
}

function Appearances({ actor }: { actor: ActorDetail }) {
  return (
    <div>
      <h2 className="text-lg font-semibold">Played in</h2>
      {actor.appearances.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {actor.appearances.map((row) => (
            <a key={row.character_id} href={`/characters/${row.character_id}`} className="rounded-xl border border-secondary bg-primary p-5">
              <div className="text-xs font-semibold text-tertiary">{row.series_title}</div>
              <div className="mt-1 text-lg font-semibold">{row.role}</div>
              <div className="mt-2">
                <Badge type="pill-color" color={row.locked ? "success" : "gray"} size="sm">
                  {row.locked ? "Ready" : "Casting"}
                </Badge>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-tertiary">Not attached to a show yet.</p>
      )}
    </div>
  );
}
