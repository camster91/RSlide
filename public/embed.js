/*! RSlide embed — MIT license — https://github.com/camster91/RSlide
 *
 * Put an RSlide event on any web page:
 *
 *   <div data-rslide="ABC123"></div>
 *   <script src="https://YOUR-RSLIDE-SITE/embed.js" async></script>
 *
 * Options (as attributes on the div):
 *   data-view="audience"  (default) people can ask, vote and answer polls
 *   data-view="screen"    the big-screen view, read only (good for live results)
 *   data-height="640"     height in pixels
 */
(function () {
  var script = document.currentScript;
  var origin = script ? new URL(script.src).origin : location.origin;

  function mount(el) {
    if (el.getAttribute("data-rslide-ready")) return;
    var code = String(el.getAttribute("data-rslide") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!code) return;
    el.setAttribute("data-rslide-ready", "1");
    var view = el.getAttribute("data-view") === "screen" ? "screen" : "audience";
    var height = parseInt(el.getAttribute("data-height") || "", 10) || (view === "screen" ? 480 : 640);
    var frame = document.createElement("iframe");
    frame.src = origin + (view === "screen" ? "/present/" : "/e/") + code + "?embed=1";
    frame.title = view === "screen" ? "Live results for event " + code : "Questions and polls for event " + code;
    frame.loading = "lazy";
    frame.allow = "clipboard-write; screen-wake-lock";
    frame.style.cssText = "width:100%;height:" + height + "px;border:0;border-radius:16px;display:block;background:transparent";
    el.innerHTML = "";
    el.appendChild(frame);
    if (view === "screen") frames.push(frame);
  }

  // The live-results view tells us its height, so it never needs its own scrollbar.
  var frames = [];
  window.addEventListener("message", function (e) {
    if (e.origin !== origin || !e.data || e.data.rslide !== "height") return;
    for (var i = 0; i < frames.length; i++)
      if (frames[i].contentWindow === e.source) frames[i].style.height = Math.max(240, Math.min(2000, e.data.h)) + "px";
  });

  function run() {
    var els = document.querySelectorAll("[data-rslide]");
    for (var i = 0; i < els.length; i++) mount(els[i]);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
  // Pages that add the div later can call this again.
  window.RSlideEmbed = { refresh: run };
})();
