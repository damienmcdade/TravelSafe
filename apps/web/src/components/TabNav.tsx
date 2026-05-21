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
    <nav className="border-b border-sand-200 bg-white">
      <ul className="max-w-5xl mx-auto flex gap-1 px-4 overflow-x-auto">
        {TABS.map((t) => {
          const active = pathname?.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                className={`block px-3 py-3 text-sm border-b-2 transition-colors ${
                  active
                    ? "border-slate2-700 text-slate2-900 font-medium"
                    : "border-transparent text-slate2-500 hover:text-slate2-700"
                }`}
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
