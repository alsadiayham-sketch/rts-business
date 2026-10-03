# RTS POS Design System

## Direction

RTS POS is a light, operational desktop product. The visual system uses the angular
RTS R mark, restrained royal-purple emphasis, pale lilac surfaces, and mint only for
positive status or completion. Product familiarity and legibility take priority over
decorative branding.

## Color

### Brand

- `royal-900`: `#2f1238` - strongest branded surfaces and high-emphasis text
- `royal-800`: `#48115b` - RTS mark, primary actions, active navigation
- `royal-700`: `#642279` - hover and secondary brand emphasis
- `royal-100`: `#f2e8f5` - selected rows and subtle brand surfaces
- `royal-50`: `#faf6fb` - app canvas tint
- `mint-500`: `#36b887` - success, online, and completed states only

### Neutral and semantic

- `canvas`: `#f8f6f9`
- `surface`: `#ffffff`
- `surface-subtle`: `#f1edf2`
- `ink`: `#211523`
- `ink-muted`: `#6f6371`
- `border`: `#ddd5df`
- `danger`: `#c93c50`
- `warning`: `#b96b13`
- `info`: `#286fa3`

Primary actions and current selection use royal purple. Mint is never a second
decorative accent. Error, warning, success, and info states always pair color with
text or an icon.

## Typography

Use `"Segoe UI", Tahoma, Arial, sans-serif` throughout. Use one family with a compact
1.125 scale. Interface labels are 13-14px, body copy 14-15px, section headings
18-22px, and the app brand 20px. Use 600-700 weight for hierarchy. Prices and totals
may use tabular numerals. Do not use display typography in operational screens.

## Shape and Elevation

- Controls: 8px radius
- Panels and dialogs: 12px radius
- Pills: reserved for statuses, filters, and compact metadata
- Borders define most separation; shadows are subtle and reserved for floating dialogs
- The RTS diagonal may appear as a small clipped corner or divider, never as a busy background

## Layout

The persistent RTL sidebar is 232px on standard desktop widths. Page headers keep the
title and primary action on one line. Sales uses a two-panel workbench: product search
and selection receive the flexible area while the cart remains stable and immediately
scannable. Tables favor clear columns, sticky headers where useful, and restrained row
height. At the minimum supported size, secondary labels may condense but primary
actions remain visible.

## Components

### Buttons

Primary buttons are solid `royal-800` with white text. Secondary buttons use a white
surface, neutral border, and dark text. Destructive actions use danger styling and are
never visually equivalent to primary completion. Every button needs default, hover,
focus-visible, active, disabled, and loading states.

### Forms

Inputs are white with a neutral border and 8px radius. Focus uses a 2px royal ring
outside the control. Labels remain visible; placeholders are examples, not labels.
Validation appears beside the field and in Arabic.

### Navigation

The active destination uses a pale royal surface, a strong royal text/icon color, and
a narrow inline indicator. Inactive navigation is quiet but high contrast. Use a
consistent SVG icon family rather than emoji.

### Data and status

Tables, product rows, cart lines, totals, and reports prioritize alignment and rapid
comparison. Empty states explain the next action. Loading uses skeletons for content
and inline progress for explicit operations. Status badges include text and restrained
semantic color.

### Dialogs

Dialogs are task-focused, keyboard operable, and no wider than their content requires.
The title, consequence, primary action, and cancel action must be immediately clear.

## Motion

Use 150-220ms ease-out transitions for hover, focus, selection, and dialog appearance.
Motion communicates state only. Honor `prefers-reduced-motion`; do not animate page
entry sequences, backgrounds, or decorative elements.

## Brand Assets

Use the supplied RTS mark without mirroring, distortion, glow, or enclosing it in a
generic circular badge. On light surfaces use `#48115b`; on royal surfaces use white.
The desktop icon uses the mark centered on a royal-purple square with a restrained
light inset field so it remains recognizable at 16px.

## Compatibility

Customer-visible identity is RTS POS. The legacy `com.ada.pos` application ID, current
update repository, and existing `ada_pos_*` localStorage keys remain temporarily as
compatibility identifiers so existing installations update in place and preserve
settings. New code must not introduce additional ADA-branded customer-facing copy.
