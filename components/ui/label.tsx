import * as React from "react";
import { Label } from "radix-ui";

import { cn } from "@/lib/utils";

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label.Root>) {
  return (
    <Label.Root
      data-slot="label"
      className={cn(
        "text-sm leading-none font-semibold select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { FieldLabel as Label };
