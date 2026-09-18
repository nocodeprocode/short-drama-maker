import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { Button } from "@/components/base/buttons/button.tsx";
import { cx } from "@/utils/cx.ts";

export function pageItems<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const safePage = Math.max(1, Math.min(page, Math.max(1, Math.ceil(items.length / pageSize))));
  return items.slice((safePage - 1) * pageSize, safePage * pageSize);
}

function visiblePages(current: number, total: number): number[] {
  const start = Math.max(1, Math.min(current - 2, total - 4));
  const end = Math.min(total, start + 4);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function CatalogPagination({
  page,
  pageSize,
  totalItems,
  noun,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  totalItems: number;
  noun: string;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;
  const current = Math.min(page, totalPages);
  const first = (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, totalItems);

  return (
    <nav className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-label={`${noun} pages`}>
      <p className="text-sm text-tertiary">
        Showing {first}–{last} of {totalItems} {noun}
      </p>
      <div className="flex items-center gap-1">
        <Button
          color="secondary"
          size="xs"
          iconLeading={CaretLeft}
          isDisabled={current === 1}
          onClick={() => onPageChange(current - 1)}
        >
          Previous
        </Button>
        <div className="hidden items-center gap-1 sm:flex">
          {visiblePages(current, totalPages).map((item) => (
            <button
              key={item}
              type="button"
              aria-label={`Page ${item}`}
              aria-current={item === current ? "page" : undefined}
              onClick={() => onPageChange(item)}
              className={cx(
                "grid size-8 cursor-pointer place-items-center rounded-lg text-sm font-semibold outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2",
                item === current ? "bg-brand-solid text-white" : "text-tertiary hover:bg-primary_hover hover:text-secondary",
              )}
            >
              {item}
            </button>
          ))}
        </div>
        <Button
          color="secondary"
          size="xs"
          iconTrailing={CaretRight}
          isDisabled={current === totalPages}
          onClick={() => onPageChange(current + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
