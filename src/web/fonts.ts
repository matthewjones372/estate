/**
 * The pages' two fonts, served by Estate itself: variable, Latin only, each under the SIL Open Font License
 * (`fonts/OFL-*`). Declared here, not by `@font-face` in a stylesheet: Bun's CSS bundler inlines a `url()` font as
 * data, where an import is emitted as a file of its own, hashed and cached for good, which the shell preloads.
 */
import instrumentSans from "./fonts/instrument-sans-latin.woff2"
import jetbrainsMono from "./fonts/jetbrains-mono-latin.woff2"

const latin =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"

const faces = [
  { family: "Instrument Sans", url: instrumentSans, weight: "400 700" },
  { family: "JetBrains Mono", url: jetbrainsMono, weight: "400 600" },
] as const

export const loadFonts = () => {
  for (const face of faces) {
    const font = new FontFace(face.family, `url("${face.url}") format("woff2")`, {
      weight: face.weight,
      display: "swap",
      unicodeRange: latin,
    })
    document.fonts.add(font)
    void font.load()
  }
}
