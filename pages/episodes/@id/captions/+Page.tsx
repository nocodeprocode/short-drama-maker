import { usePageContext } from "vike-react/usePageContext";
import { Button } from "@/components/base/buttons/button";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import { EpisodeSkeleton, LoadError } from "@/components/drama/skeleton.tsx";
import { captionCues } from "@/engine/present.ts";
import { studio } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

export default function Page() {
  const id = usePageContext().routeParams.id;
  const { data: episode, error, reload } = useStudio(`episode:${id}`, () => studio.episode(id), [id]);
  const cues = captionCues(episode?.shots ?? []);

  if (error && !episode) return <LoadError message={error} onRetry={() => void reload()} />;
  if (!episode) return <EpisodeSkeleton />;

  return (
    <>
      <PageHeader
        eyebrow={`${episode.series_title} · Episode ${episode.episode_number}`}
        title="Captions"
        subtitle={cues.length ? "Timed from the recorded dialogue." : "Captions appear after dialogue is recorded."}
        actions={
          <Button href={`/episodes/${id}`} color="secondary">
            Back to episode
          </Button>
        }
      />
      <PageBody>
        {cues.length === 0 ? (
          <div className="ds-empty">
            <p className="text-sm font-semibold">No captions yet</p>
            <p className="mt-1 text-sm text-tertiary">Come back when the episode has spoken lines.</p>
          </div>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[300px_1fr]">
            <div className="relative">
              <Poster tone={episode.poster_tone} ratio="916" />
              <div
                className="absolute right-[6%] bottom-[22%] left-[6%] z-10 text-center text-[20px] font-bold text-white"
                style={{ textShadow: "-1.5px -1.5px 0 #101828, 1.5px -1.5px 0 #101828, -1.5px 1.5px 0 #101828, 1.5px 1.5px 0 #101828" }}
              >
                {cues[0]?.text}
              </div>
            </div>
            <div className="rounded-xl border border-secondary bg-primary">
              <div className="border-b border-secondary px-6 py-4">
                <h3 className="text-lg font-semibold">Cues</h3>
              </div>
              {cues.map((cue) => (
                <div key={cue.id} className="grid grid-cols-[96px_1fr] gap-3 border-b border-secondary px-5 py-3.5 last:border-0">
                  <span className="text-[11px] font-semibold tracking-wide text-tertiary uppercase">{cue.who}</span>
                  <span className="text-sm">{cue.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}
