// Every route change animates in, across the whole app.
//
// This is a `template`, not a `layout`, and that is the entire trick: Next
// re-creates a template on every navigation (a layout persists), so the
// wrapper below remounts each time and its CSS entrance animation replays.
// One file, no library, no per-page wiring — /owner/dashboard → /owner/editor
// glides, and so does anything added later.
//
// The motion is deliberately restrained: pages here already animate their own
// contents in (`.rise`), so a heavy page-level move would stack on top of that
// and read as lag rather than polish.
//
// NOTE for anyone tempted to make it fancier: an animation that LEAVES a
// transform on this element would turn it into the containing block for every
// `position: fixed` descendant — every bottom sheet in the owner panel would
// anchor to the page instead of the viewport. The keyframes below therefore
// end at `transform: none`.

export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>
}
