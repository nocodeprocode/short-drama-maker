import { useEffect, useState } from "react";
import { Image01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { FileDrop } from "@/components/base/file-drop/file-drop";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/input/textarea";
import { studio, type Actor } from "@/lib/api.ts";
import { prepareImageUpload } from "@/lib/image-upload.ts";

export function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * Adds a face to the account's catalog, either written from notes or built from
 * a photo the buyer holds the rights to. The same form serves the Actors page
 * and the in-place "add someone new" step while casting a show.
 */
export function NewActorForm({
  onDone,
  onCancel,
  compact,
  seriesId,
}: {
  onDone: (actor: Actor) => void;
  onCancel: () => void;
  compact?: boolean;
  /** Set when adding a face mid-cast, so the face job lands on that show. */
  seriesId?: string;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [likeness, setLikeness] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const upload = file ? await prepareImageUpload(file) : null;
      const actor = await studio.createActor({
        name,
        description,
        tags: parseTags(tags),
        series_id: seriesId,
        likeness_confirmed: file ? likeness : undefined,
        seed_base64: upload?.base64,
        seed_mime_type: upload?.mimeType,
      });
      onDone(actor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the actor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={
        compact
          ? "flex flex-col gap-4"
          : "mb-6 flex max-w-xl flex-col gap-4 rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset"
      }
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {compact ? null : <h2 className="text-md font-semibold">New actor</h2>}
      <Input label="Name" isRequired value={name} onChange={setName} placeholder="Mara Voss" />
      <TextArea
        label="Look notes"
        value={description}
        onChange={setDescription}
        rows={3}
        placeholder="Optional. Hair, bearing, the face you want held."
      />
      <Input
        label="Tags"
        value={tags}
        onChange={setTags}
        placeholder="lead, my face, franchise"
        hint="Comma separated. Tags are how you find this face again on the next show."
      />
      <FileDrop
        label="Seed photo"
        accept="image/png,image/jpeg,image/webp"
        icon={Image01}
        title="Drop a photo or browse"
        subtitle="Optional. A photo of you, or an actor you have the rights to. JPG, PNG, or WebP."
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
      {error ? <p className="text-sm text-error-primary">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          color="primary"
          size="sm"
          isDisabled={busy || !name.trim() || (Boolean(file) && !likeness)}
        >
          {busy ? "Creating…" : file ? "Create from photo" : "Create"}
        </Button>
        <Button type="button" color="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="text-xs text-tertiary">
        The face pack is generated in the background. It shows up here and on every show you cast this actor in.
      </p>
    </form>
  );
}
