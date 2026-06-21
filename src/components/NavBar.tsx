"use client";

type Tab = "cart" | "scan" | "search";

interface NavBarProps {
  current: Tab;
  onChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "cart",
    label: "Cart",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
      </svg>
    ),
  },
  {
    id: "scan",
    label: "Scan",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <line x1="7" y1="12" x2="17" y2="12" />
      </svg>
    ),
  },
  {
    id: "search",
    label: "Search",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
];

export function NavBar({ current, onChange }: NavBarProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-aldi-border safe-bottom z-50">
      <div className="max-w-2xl mx-auto flex">
        {TABS.map((t) => {
          const active = t.id === current;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={
                "flex-1 flex flex-col items-center gap-1 py-2 text-xs font-medium transition-colors " +
                (active ? "text-aldi-blue" : "text-aldi-text-muted hover:text-aldi-text")
              }
              aria-label={t.label}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
