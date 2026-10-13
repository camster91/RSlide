// Preact 11 no longer adds "px" to numbers in inline styles, so `style={{ fontSize: 22 }}`
// was silently ignored. This restores the old behaviour app-wide, so a number means pixels
// (except for properties that take plain numbers, like opacity or z-index).
import { options } from "preact";

const UNITLESS = /^(?:opacity|z-?index|zoom|order|flex(?:-?grow|-?shrink)?|flex|font-?weight|line-?height|orphans|widows|columns|column-?count|tab-?size|grid-?(?:row|column)(?:-?(?:start|end))?|aspect-?ratio|scale|animation-?iteration-?count|fill-?opacity|stroke-?opacity|stroke-?width|stop-?opacity|flood-?opacity)$/i;

const prev = options.vnode;
options.vnode = (vnode) => {
  const props = vnode.props as { style?: unknown } | null;
  const style = props?.style;
  if (style && typeof style === "object" && typeof vnode.type === "string") {
    let copy: Record<string, unknown> | null = null;
    for (const [k, v] of Object.entries(style as Record<string, unknown>)) {
      if (typeof v === "number" && v !== 0 && !k.startsWith("--") && !UNITLESS.test(k)) {
        copy ??= { ...(style as Record<string, unknown>) };
        copy[k] = `${v}px`;
      }
    }
    if (copy) props!.style = copy;
  }
  prev?.(vnode);
};
