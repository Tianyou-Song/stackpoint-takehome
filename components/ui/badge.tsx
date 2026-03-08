import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
  className?: string;
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variant === "default" && "bg-blue-100 text-blue-800",
        variant === "secondary" && "bg-gray-100 text-gray-800",
        variant === "destructive" && "bg-red-100 text-red-800",
        variant === "outline" && "border border-gray-300 text-gray-700",
        variant === "success" && "bg-green-100 text-green-800",
        variant === "warning" && "bg-yellow-100 text-yellow-800",
        className
      )}
    >
      {children}
    </span>
  );
}
