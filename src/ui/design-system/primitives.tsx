import {
  Badge as FragmentsBadge,
  Button as FragmentsButton,
  Card as FragmentsCard,
  ToggleGroup as FragmentsToggleGroup,
  type BadgeProps,
  type ButtonProps,
  type CardProps,
  type ToggleGroupItemProps,
  type ToggleGroupProps,
} from '@usefragments/ui';

function classes(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function Button({ className, variant = 'solid', tone, ...props }: ButtonProps) {
  return <FragmentsButton {...props} variant={variant} tone={tone} className={classes('ds-button', className)} data-ds-variant={variant} data-ds-tone={tone ?? (variant === 'solid' || variant === 'link' ? 'accent' : 'neutral')}/>;
}

export function Badge({ className, tone = 'neutral', variant = 'soft', ...props }: BadgeProps) {
  return <FragmentsBadge {...props} tone={tone} variant={variant} className={classes('ds-badge', className)} data-ds-tone={tone} data-ds-variant={variant}/>;
}

function CardRoot({ className, variant = 'solid', ...props }: CardProps) {
  return <FragmentsCard {...props} variant={variant} className={classes('ds-card', className)} data-ds-variant={variant}/>;
}

export const Card = Object.assign(CardRoot, {
  Header: FragmentsCard.Header,
  Title: FragmentsCard.Title,
  Description: FragmentsCard.Description,
  Body: FragmentsCard.Body,
  Footer: FragmentsCard.Footer,
});

function ToggleGroupRoot({ className, ...props }: ToggleGroupProps) {
  return <FragmentsToggleGroup {...props} className={classes('ds-toggle-group', className)}/>;
}

function ToggleGroupItem({ className, ...props }: ToggleGroupItemProps) {
  return <FragmentsToggleGroup.Item {...props} className={classes('ds-toggle-item', className)}/>;
}

export const ToggleGroup = Object.assign(ToggleGroupRoot, { Item: ToggleGroupItem });
