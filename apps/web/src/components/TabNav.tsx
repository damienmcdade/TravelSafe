"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/threats",      label: "Awareness" },
  { href: "/map",          label: "Crime Map" },
  { href: "/safety",       label: "Personal Safety" },
  { href: "/community",    label: "CommunitySafe" },
  { href: "/neighborhood", label: "Neighborhood Watch" },
];

export function TabNav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-sand-200 bg-white/80 backdrop-blur sticky top-0 z-20">
      <ul className="max-w-5xl mx-auto flex gap-1 px-4 overflow-x-auto">
        {TABS.map((t) => {
          const active = pathname?.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                className={`tab-link ${active ? "is-active text-slate2-900 font-medium" : "text-slate2-500 hover:text-bay-700"}`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
