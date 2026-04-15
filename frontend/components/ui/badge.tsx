import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide border",
  {
    variants: {
      variant: {
        default:  "bg-sl-green-dim  text-sl-green-l  border-sl-green/30",
        red:      "bg-sl-red-dim    text-sl-red       border-sl-red/30",
        amber:    "bg-sl-amber-dim  text-sl-amber     border-sl-amber/30",
        blue:     "bg-sl-blue-dim   text-sl-blue      border-sl-blue/30",
        muted:    "bg-sl-elevated   text-sl-text-2    border-sl-border",
        outline:  "bg-transparent   text-sl-text-2    border-sl-border",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
