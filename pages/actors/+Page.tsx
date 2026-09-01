import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { CastCard, CastCardSkeleton } from "@/components/drama/cast-card.tsx";
import { LoadError } from "@/components/drama/skeleton.tsx";
import { studio } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

export default function Page() {
  const { data, error, reload } = useStudio("actors", () => studio.actors());
  const [open, setOpen] = useState(false);

  if (error && !data) return <LoadError message={error} onRetry={() => void reload()} />;

  return (
    <>
      <PageHeader
        title="Actors"
        subtitle="Reusable faces you can attach to any show."
        actions={
          <Button color="primary" size="sm" onClick={() => setOpen(true)}>
            New actor
          </Button>
        }
      />
      <PageBody>
        {open ? <NewActorForm onDone={() => { setOpen(false); void reload(); }} onCancel={() => setOpen(false)} /> : null}
        {!data ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <CastCardSkeleton key={index} />
            ))}
          </div>
        ) : null}
        {data?.items.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((actor) => (
              <CastCard
                key={actor.id}
                href={`/actors/${actor.id}`}
                name={actor.name}
                stillUrl={actor.still_url}
                refs={actor.refs}
                emptyLabel="Casting"
              />
            ))}
          </div>
        ) : null}
        {data && data.items.length === 0 ? (
          <p className="text-sm text-tertiary">Actors appear after a show starts, or you can create one now.</p>
        ) : null}
      </PageBody>
    </>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function NewActorForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [likeness, setLikeness] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let seed_base64: string | undefined;
      if (file) seed_base64 = await fileToBase64(file);
      await studio.createActor({
        name,
        description,
        likeness_confirmed: file ? likeness : undefined,
        seed_base64,
        seed_mime_type: file?.type,
      });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the actor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mb-6 max-w-xl space-y-3 rounded-xl border border-secondary bg-primary p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 className="text-sm font-semibold">New actor</h2>
      <input
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name"
        className="w-full rounded-lg border border-secondary px-3 py-2 text-sm"
      />
      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Look notes (optional)"
        className="w-full rounded-lg border border-secondary px-3 py-2 text-sm"
        rows={3}
      />
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      {file ? (
        <label className="flex items-start gap-2 text-sm text-secondary">
          <input type="checkbox" checked={likeness} onChange={(event) => setLikeness(event.target.checked)} />
          <span>I confirm I have the rights to use this person’s likeness for this account.</span>
        </label>
      ) : null}
      {error ? <p className="text-sm text-error-primary">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" color="primary" size="sm" isDisabled={busy || !name.trim() || (Boolean(file) && !likeness)}>
          {busy ? "Creating…" : "Create"}
        </Button>
        <Button type="button" color="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
