const paths = {
  download: "M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4",
  volumes: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 4 9 5 9-5",
  chapters: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  list: "m3 6 2 2 3-4m-5 9 2 2 3-4m4-5h9m-9 7h9m-9 6h9",
  check: "m4 12 5 5L20 6",
  archive: "M5 8v12h14V8M4 4h16v4H4zm6 8h4",
  lock: "M8 10V7a4 4 0 1 1 8 0v3",
  next: "m9 5 7 7-7 7",
  external: "M13 5h6v6m0-6-8 8m6 0v5H6V7h5",
  grip: "M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01",
}
export function PanelIcon({
  name,
  className,
}: {
  name: keyof typeof paths
  className?: string
}) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "lock" && <rect x="5" y="10" width="14" height="10" rx="2" />}
      <path d={paths[name]} strokeWidth={name === "grip" ? 3 : undefined} />
    </svg>
  )
}
