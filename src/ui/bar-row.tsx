// The sticky bar row at the foot of a place (M3 Package 7): the capture bar,
// and with Kev on, Ask Kev at its end (M8 Package 4). Presentational only.
export function BarRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-paper border-line sticky bottom-0 z-10 border-t px-5 py-3">
      <div className="mx-auto w-full max-w-[720px]">{children}</div>
    </div>
  );
}
