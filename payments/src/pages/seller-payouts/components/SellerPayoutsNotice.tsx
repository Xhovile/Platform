export default function SellerPayoutsNotice({
  type,
  message,
  details,
}: {
  type: "success" | "error" | "info";
  message: string;
  details?: string[];
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${
        type === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : type === "error"
            ? "border-red-200 bg-red-50 text-red-800"
            : "border-amber-200 bg-amber-50 text-amber-800"
      }`}
    >
      <div>{message}</div>
      {details && details.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs font-medium opacity-90">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
