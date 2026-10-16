// Kev's mark (docs/BRAND.md §05): a soft four-point spark, never a face. On
// the 36-unit grid, one 1.75 stroke, round caps and joins, no fill. Always
// decorative: whatever carries it names itself ("Ask Kev").
export function Spark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      aria-hidden="true"
      focusable="false"
      className={`${className} shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75]`}
    >
      <path d="M18 7c1.2 6.2 4.8 9.8 11 11-6.2 1.2-9.8 4.8-11 11-1.2-6.2-4.8-9.8-11-11 6.2-1.2 9.8-4.8 11-11Z" />
    </svg>
  );
}
