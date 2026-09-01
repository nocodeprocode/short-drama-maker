export function ShotGrid({
  approved = 0,
  generating = 0,
  review = 0,
  queued = 0,
  mini = false,
}: {
  approved?: number;
  generating?: number;
  review?: number;
  queued?: number;
  mini?: boolean;
}) {
  const cells = [
    ...Array.from({ length: approved }, () => "ok"),
    ...Array.from({ length: generating }, () => "gen"),
    ...Array.from({ length: review }, () => "rev"),
    ...Array.from({ length: queued }, () => ""),
  ];
  return (
    <div
      className={mini ? "shotgrid mini" : "shotgrid"}
      aria-label={`${approved} approved, ${generating} generating, ${review} need review, ${queued} queued`}
    >
      {cells.map((state, index) => (
        <i key={index} className={state} />
      ))}
    </div>
  );
}
