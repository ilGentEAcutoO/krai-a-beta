# Third-party notices

The code in this repository is MIT-licensed (see [LICENSE](LICENSE)). The
files below are not ours, or were made with third-party services, and keep
their own terms.

## Fonts (`app/public/fonts/`)

| Font | Files | License |
|---|---|---|
| IBM Plex Sans Thai, © 2017 IBM Corp. (Reserved Font Name "Plex") | `ibm-plex-sans-thai-*.woff2` | SIL Open Font License 1.1, [LICENSES/OFL-IBMPlexSansThai.txt](LICENSES/OFL-IBMPlexSansThai.txt) |
| Anuphan, © 2019 The Anuphan Project Authors | `anuphan-*.woff2` | SIL Open Font License 1.1, [LICENSES/OFL-Anuphan.txt](LICENSES/OFL-Anuphan.txt) |

The `.woff2` files are unmodified-glyph web subsets (Latin and Thai ranges)
of the upstream fonts, as served by Google Fonts.

## Generated media

- `app/public/audio/*.mp3` and `app/public/audio/calls/*.mp3`: speech
  synthesised with Google Gemini TTS (`scripts/tts-pregen.mjs`) from scripts
  written for this project. All callers, names and numbers are fictional.
- The datasets in `corpus/` and `eval/` are synthetic; how each set was made
  (by hand, Muse Wonder or Claude, with dates) is recorded in
  [corpus/README.md](corpus/README.md) and the pre-registration files in
  `app/public/proof/`.
