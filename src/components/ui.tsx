import {
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent,
  type SelectHTMLAttributes,
  forwardRef,
} from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const btnBase =
  "inline-flex items-center justify-center font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50 disabled:pointer-events-none";

const btnVariants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "bg-white text-text ring-1 ring-border/80 hover:bg-surface-alt",
  ghost: "text-text-secondary hover:bg-surface-alt",
  danger: "bg-danger-light text-danger hover:bg-danger/10",
};

const btnSizes: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-1.5 rounded-lg gap-1.5",
  md: "text-sm px-4 py-2 rounded-lg gap-2",
  lg: "text-sm px-6 py-2.5 rounded-lg gap-2",
};

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  return <button className={`${btnBase} ${btnVariants[variant]} ${btnSizes[size]} ${className}`} {...props} />;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", type, onClick, ...props }, ref) {
    const openDatePicker = (e: MouseEvent<HTMLInputElement>) => {
      onClick?.(e);
      if (e.defaultPrevented || type !== "date") return;
      try {
        e.currentTarget.showPicker?.();
      } catch {
        /* ignore */
      }
    };
    return (
      <input
        ref={ref}
        className={`w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text placeholder:text-text-dim outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${className}`}
        {...props}
        type={type}
        onClick={type === "date" ? openDatePicker : onClick}
      />
    );
  }
);

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = "", ...props }, ref) {
    return (
      <select
        ref={ref}
        className={`w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 ${className}`}
        {...props}
      />
    );
  }
);

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className}`}>{children}</div>;
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-6 py-4 ${className}`}>{children}</div>;
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-6 py-5 ${className}`}>{children}</div>;
}

type BadgeVariant = "default" | "primary" | "success" | "warning" | "danger";

const badgeColors: Record<BadgeVariant, string> = {
  default: "bg-surface-alt/80 text-text-dim",
  primary: "bg-primary-light text-primary",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning ring-1 ring-warning/20",
  danger: "bg-danger-light text-danger",
};

export function Badge({
  children,
  variant = "default",
  className = "",
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeColors[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

export function PageWrapper({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-[1280px] px-6 py-8 lg:max-w-[1400px] lg:px-10 lg:py-12 ${className}`}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  className = "",
}: {
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <h1 className="text-2xl font-semibold tracking-tight text-text lg:text-3xl">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-text-muted">{subtitle}</p>}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-text-muted">{description}</p>}
    </div>
  );
}

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-primary ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
