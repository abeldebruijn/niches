"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export function ModeToggle() {
  const { theme = "system", setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const nextTheme =
    theme === "system" ? "light" : theme === "light" ? "dark" : "system";

  const label =
    theme === "system"
      ? "Theme: System"
      : theme === "light"
        ? "Theme: Light"
        : "Theme: Dark";

  // Use consistent placeholder during SSR to avoid hydration mismatch
  const ssrLabel = "Theme: System. Click to change theme.";

  return (
    <Button
      variant="outline"
      size="icon"
      className="relative rounded-full bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/65"
      onClick={() => {
        setTheme(nextTheme);
      }}
      aria-label={mounted ? `${label}. Click to change theme.` : ssrLabel}
      title={mounted ? `${label}. Click to change theme.` : ssrLabel}
    >
      {mounted && theme === "system" ? (
        <Monitor className="size-[1.15rem]" />
      ) : (
        <>
          <Sun className="size-[1.15rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute size-[1.15rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </>
      )}
      <span className="sr-only">{mounted ? label : "Theme: System"}</span>
    </Button>
  );
}
