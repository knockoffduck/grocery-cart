import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useHaptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";
import type { SearchProduct } from "@/lib/hooks/use-product-search";

export interface ProductSearchSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  query: string;
  onQueryChange: (q: string) => void;
  results: SearchProduct[];
  searching: boolean;
  /** Called when the user picks a product from the results. */
  onPick: (p: SearchProduct) => void;
  /** Disable all pick buttons while a pick is in flight. */
  busy?: boolean;
  /** Label for the pick button. */
  actionLabel?: string;
  /** SKUs rendered as already-selected instead of a pick button. */
  disabledSkus?: string[];
  /** Label shown on disabled rows (defaults to actionLabel). */
  disabledLabel?: string;
  /** Hint shown before the user has typed anything. */
  emptyHint?: string;
}

const MOBILE_QUERY = "(max-width: 639px)";

/**
 * Render the sheet as a vaul bottom drawer on phones and a centered
 * Radix dialog from the `sm` breakpoint up. Only one is mounted at a
 * time so their focus traps never fight.
 */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window === "undefined" || !window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(!e.matches);
    setIsDesktop(!mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

/**
 * Modal product search built on shadcn/ui primitives. The search state
 * lives in the caller via useProductSearch, so the sheet stays dumb and
 * reusable across the cart swap flow and the scanner correction flows.
 */
export function ProductSearchSheet({
  open,
  onOpenChange,
  title,
  description,
  query,
  onQueryChange,
  results,
  searching,
  onPick,
  busy = false,
  actionLabel = "Use",
  disabledSkus,
  disabledLabel,
  emptyHint = "Start typing to search the catalogue.",
}: ProductSearchSheetProps) {
  const isDesktop = useIsDesktop();

  const body = (
    <SearchBody
      query={query}
      onQueryChange={onQueryChange}
      results={results}
      searching={searching}
      onPick={onPick}
      busy={busy}
      actionLabel={actionLabel}
      disabledSkus={disabledSkus}
      disabledLabel={disabledLabel}
      emptyHint={emptyHint}
    />
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        >
          <DialogHeader className="shrink-0 border-b px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="text-sm font-semibold">{title}</DialogTitle>
                {description && (
                  <DialogDescription className="mt-1 line-clamp-2 text-xs">
                    {description}
                  </DialogDescription>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => onOpenChange(false)}
                aria-label="Close"
              >
                <X />
              </Button>
            </div>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader className="shrink-0 border-b px-4 py-3 text-left">
          <DrawerTitle className="text-sm font-semibold">{title}</DrawerTitle>
          {description && (
            <DrawerDescription className="line-clamp-2 text-xs">
              {description}
            </DrawerDescription>
          )}
        </DrawerHeader>
        {body}
      </DrawerContent>
    </Drawer>
  );
}

function SearchBody({
  query,
  onQueryChange,
  results,
  searching,
  onPick,
  busy,
  actionLabel,
  disabledSkus,
  disabledLabel,
  emptyHint,
}: Omit<ProductSearchSheetProps, "open" | "onOpenChange" | "title" | "description">) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hapticRef = useHaptic<HTMLButtonElement>();

  // Autofocus once the portal content has mounted.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <div className="shrink-0 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search Aldi products…"
            className="h-10 pl-9 pr-9"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              className="absolute top-1/2 right-2.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-full bg-aldi-border text-aldi-text-muted transition hover:bg-aldi-text-muted hover:text-white"
              aria-label="Clear"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        {searching && results.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Searching…
          </div>
        ) : results.length > 0 ? (
          <ul className="divide-y divide-aldi-border">
            {results.map((p) => {
              const isDisabled = disabledSkus?.includes(p.sku) ?? false;
              return (
                <li key={p.sku} className="flex items-center gap-3 p-3">
                  <ProductThumb image={p.image} className="size-10" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm leading-snug font-medium line-clamp-2">
                      {p.name}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {p.brand}
                      {p.sellingSize ? ` · ${p.sellingSize}` : ""}
                    </div>
                    {p.priceDisplay && (
                      <div className="mt-0.5 text-sm font-semibold text-aldi-blue tabular-nums">
                        {p.priceDisplay}
                      </div>
                    )}
                  </div>
                  <Button
                    ref={hapticRef}
                    size="sm"
                    className="rounded-full"
                    onClick={() => onPick(p)}
                    disabled={busy || isDisabled}
                    variant={isDisabled ? "secondary" : "default"}
                  >
                    {isDisabled ? (disabledLabel ?? actionLabel) : busy ? "…" : actionLabel}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : query.trim().length > 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No matches for &ldquo;{query}&rdquo;.
          </div>
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {emptyHint}
          </div>
        )}
      </div>
    </>
  );
}

export function ProductThumb({
  image,
  className,
}: {
  image: string | null;
  className?: string;
}) {
  if (!image) {
    return <div className={cn("shrink-0 rounded bg-aldi-bg", className)} />;
  }
  return (
    <img
      src={image}
      alt=""
      loading="lazy"
      className={cn("shrink-0 rounded bg-aldi-bg object-contain", className)}
      onError={(e) => {
        (e.target as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}
