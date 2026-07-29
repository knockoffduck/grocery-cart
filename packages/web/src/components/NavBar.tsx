import { ScanLine, Search, ShoppingCart } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useHaptic } from "@/lib/haptics";

type Tab = "cart" | "scan" | "search";

interface NavBarProps {
  current: Tab;
  onChange: (tab: Tab) => void;
  cartCount?: number;
}

export function NavBar({ current, onChange, cartCount = 0 }: NavBarProps) {
  const hapticRef = useHaptic<HTMLButtonElement>();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 safe-bottom">
      <div className="max-w-2xl mx-auto relative">
        {/* Elevated scan button — the primary action sits above the bar */}
        <button
          ref={hapticRef}
          onClick={() => onChange("scan")}
          className={
            "absolute left-1/2 -translate-x-1/2 -top-6 w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-90 " +
            (current === "scan"
              ? "bg-aldi-orange text-white fab-ring"
              : "bg-aldi-orange text-white hover:brightness-110")
          }
          aria-label="Scan barcode"
        >
          <ScanLine className="w-6 h-6" strokeWidth={2.2} />
        </button>

        <div className="flex bg-white border-t border-aldi-border shadow-[0_-2px_12px_rgba(15,23,42,0.06)]">
          {/* Cart tab */}
          <TabButton
            active={current === "cart"}
            label="Cart"
            onClick={() => onChange("cart")}
            badge={cartCount > 0 ? cartCount : undefined}
            icon={<ShoppingCart className="w-6 h-6" />}
          />

          {/* Spacer for the elevated scan button */}
          <div className="w-20 shrink-0" aria-hidden="true" />

          {/* Search tab */}
          <TabButton
            active={current === "search"}
            label="Search"
            onClick={() => onChange("search")}
            icon={<Search className="w-6 h-6" />}
          />
        </div>
      </div>
    </nav>
  );
}

function TabButton({
  active,
  label,
  onClick,
  icon,
  badge,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  badge?: number;
}) {
  const hapticRef = useHaptic<HTMLButtonElement>();

  return (
    <button
      ref={hapticRef}
      onClick={onClick}
      className={
        "flex-1 flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium transition-colors relative " +
        (active ? "text-aldi-blue" : "text-aldi-text-muted hover:text-aldi-text")
      }
      aria-label={badge ? `${label} (${badge} items)` : label}
      aria-current={active ? "page" : undefined}
    >
      {/* Active indicator pill */}
      <span
        className={
          "absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-aldi-blue transition-all duration-200 " +
          (active ? "opacity-100 scale-x-100" : "opacity-0 scale-x-50")
        }
        aria-hidden="true"
      />
      <span className="relative">
        {icon}
        {badge != null && badge > 0 && (
          <Badge
            key={badge}
            className="badge-pop absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] rounded-full bg-aldi-orange px-1 text-[10px] font-bold leading-[18px] text-white"
          >
            {badge > 99 ? "99+" : badge}
          </Badge>
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}
