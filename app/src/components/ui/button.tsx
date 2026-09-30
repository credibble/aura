import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all duration-150 active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 rounded-lg",
  {
    variants: {
      variant: {
        default: "gradient-primary text-primary-foreground hover:opacity-90 shadow-block-primary",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-lg shadow-block-destructive",
        outline:
          "border border-input bg-background/60 backdrop-blur-sm hover:bg-secondary hover:text-secondary-foreground shadow-block-outline",
        secondary:
          "bg-secondary/80 backdrop-blur-sm text-secondary-foreground hover:bg-secondary shadow-block-secondary",
        ghost: "hover:bg-secondary/80 hover:text-secondary-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        accent: "gradient-accent text-accent-foreground hover:opacity-90 shadow-block-accent",
        yellow: "gradient-yellow text-foreground hover:opacity-90 shadow-block-yellow",
        blue: "gradient-blue text-white hover:opacity-90 shadow-block-blue",
        soft: "bg-primary/10 text-primary hover:bg-primary/20 backdrop-blur-sm shadow-block-soft",
        glass: "glass text-foreground hover:bg-white/80 shadow-block-glass",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
