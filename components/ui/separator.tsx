import * as React from "react";
import { Separator } from "radix-ui";

import { cn } from "@/lib/utils";

function AppSeparator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof Separator.Root>) {
  return (
    <Separator.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "bg-border shrink-0",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
}

export { AppSeparator as Separator };
