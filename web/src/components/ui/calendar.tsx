import * as React from "react";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { DayPicker, getDefaultClassNames, type DayButton } from "react-day-picker";

import { cn } from "../../lib/cn";

const DATE_VALUE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a Rails date without letting the runtime timezone reinterpret it. */
function parseCalendarValue(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;

  const match = DATE_VALUE.exec(value);
  if (!match) return undefined;

  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));

  return date.getFullYear() === Number(match[1]) &&
    date.getMonth() === Number(match[2]) - 1 &&
    date.getDate() === Number(match[3])
    ? date
    : undefined;
}

/** Format a selected local calendar day as the Rails date-only value. */
function formatCalendarValue(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

export type CalendarProps = Omit<
  React.ComponentProps<typeof DayPicker>,
  "mode" | "selected" | "onSelect"
> & {
  value?: string | null;
  onChange?: (value: string | undefined) => void;
};

function Calendar({
  className,
  classNames,
  components,
  formatters,
  onChange,
  showOutsideDays = true,
  value,
  ...props
}: CalendarProps) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      {...props}
      mode="single"
      selected={parseCalendarValue(value)}
      onSelect={(date) => onChange?.(date ? formatCalendarValue(date) : undefined)}
      showOutsideDays={showOutsideDays}
      className={cn(
        "group/calendar w-fit rounded-panel bg-surface p-3 font-sans text-ink",
        className,
      )}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn("relative flex flex-col gap-4 md:flex-row", defaultClassNames.months),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav,
        ),
        button_previous: cn(
          "inline-flex size-11 items-center justify-center rounded-control border border-border bg-surface text-ink-soft outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50",
          defaultClassNames.button_previous,
        ),
        button_next: cn(
          "inline-flex size-11 items-center justify-center rounded-control border border-border bg-surface text-ink-soft outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50",
          defaultClassNames.button_next,
        ),
        month_caption: cn(
          "flex h-11 w-full items-center justify-center px-11 text-sm font-semibold text-ink",
          defaultClassNames.month_caption,
        ),
        dropdowns: cn(
          "flex h-11 w-full items-center justify-center gap-1.5 text-sm font-medium",
          defaultClassNames.dropdowns,
        ),
        dropdown_root: cn(
          "relative rounded-control border border-border-strong bg-surface shadow-sm focus-within:ring-2 focus-within:ring-accent",
          defaultClassNames.dropdown_root,
        ),
        dropdown: cn("absolute inset-0 bg-surface opacity-0", defaultClassNames.dropdown),
        caption_label: cn("font-semibold select-none", defaultClassNames.caption_label),
        month_grid: cn("w-full border-collapse", defaultClassNames.month_grid),
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "flex-1 rounded-control text-xs font-semibold uppercase tracking-wide text-ink-faint select-none",
          defaultClassNames.weekday,
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn("w-11 select-none", defaultClassNames.week_number_header),
        week_number: cn("text-xs text-ink-faint select-none", defaultClassNames.week_number),
        day: cn(
          "group/day relative aspect-square h-full w-full p-0 text-center select-none",
          defaultClassNames.day,
        ),
        range_start: cn("rounded-l-control bg-accent", defaultClassNames.range_start),
        range_middle: cn("rounded-none", defaultClassNames.range_middle),
        range_end: cn("rounded-r-control bg-accent", defaultClassNames.range_end),
        today: cn("rounded-control", defaultClassNames.today),
        outside: cn("text-ink-faint opacity-60", defaultClassNames.outside),
        disabled: cn("cursor-not-allowed text-ink-faint opacity-50", defaultClassNames.disabled),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className: rootClassName, rootRef, ...rootProps }) => (
          <div data-slot="calendar" ref={rootRef} className={cn(rootClassName)} {...rootProps} />
        ),
        Chevron: ({ className: chevronClassName, orientation, ...chevronProps }) => {
          if (orientation === "left") {
            return <ChevronLeftIcon className={cn("size-4", chevronClassName)} {...chevronProps} />;
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon className={cn("size-4", chevronClassName)} {...chevronProps} />
            );
          }

          return <ChevronDownIcon className={cn("size-4", chevronClassName)} {...chevronProps} />;
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...weekNumberProps }) => (
          <td {...weekNumberProps}>
            <div className="flex size-11 items-center justify-center text-center">{children}</div>
          </td>
        ),
        ...components,
      }}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames();
  const ref = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  return (
    <button
      {...props}
      ref={ref}
      type="button"
      data-day={formatCalendarValue(day.date)}
      data-today={modifiers.today ? "true" : undefined}
      className={cn(
        "flex size-11 min-w-11 flex-col items-center justify-center rounded-control text-sm font-normal leading-none text-ink outline-none select-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-accent",
        modifiers.today && !modifiers.selected && "bg-accent-soft text-accent-ink",
        modifiers.selected && "bg-accent text-surface hover:bg-accent-strong",
        modifiers.outside && "text-ink-faint opacity-60",
        modifiers.disabled && "cursor-not-allowed opacity-50",
        defaultClassNames.day_button,
        className,
      )}
    />
  );
}

export { Calendar, CalendarDayButton };
