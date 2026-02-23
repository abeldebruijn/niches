import { Label } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label.Root>) {
  return (
    <Label.Root
      data-slot="label"
      className={cn(
        "select-none font-semibold text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { FieldLabel as Label };
