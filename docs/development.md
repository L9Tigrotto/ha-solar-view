# Development

There is no build step. The three files in `dist/` are what Home Assistant loads, and what HACS downloads: it takes every `.js` file in that folder, so nothing else belongs there.

| File | What is in it |
|---|---|
| `solar-view.js` | Rules, logic, data loading, drawing, the custom element. |
| `strings.js` | Every text, one object per language. |
| `styles.js` | The stylesheet, as one string. |

## Preview tool

`preview/index.html` runs the real page against a fake Home Assistant with made-up numbers, and checks it on every load. Serve the repository folder with any static web server, for example:

```bash
npx serve .
```

Then open `/preview/`.

| Parameter | Values |
|---|---|
| `scenario` | `midday`, `full`, `dawn`, `dusk`, `night`, `evening`, `poor`, `poorNoForecast`, `nobattery`, `nodata`, `offline` |
| `lang` | `en`, `it`, `es`, `fr`, `de`, `pt`, `nl`, `pl` |
| `dark` | `0` or `1` |
| `admin` | `0` hides the Info page |
| `extras` | `0` removes prices and forecast |
| `loading` | seconds of loading skeleton before the numbers arrive |
| `first` | `1` shows the skeleton of a first visit |
| `day` | which advice line of the pool to show |
| `page` | `today`, `history` or `details`: open on that page |
| `shot` | `1` hides the tool's own controls, for screenshots |
| `check` | `skeleton` compares the loading skeleton with the loaded page |

## Checks

The checks are `console.assert` calls in the preview page. The browser console must stay free of assertion failures.

Warnings that say "loading the numbers failed Error: check" come from the tool's own failure test and are expected.

The scenarios have no hourly statistics, so "enough until" uses the present draw and the checks give the same result at any time of day. The walk through the usual day is checked on its own, with fixed hours.

`?check=skeleton` must log "0 differ": the loading skeleton has to sit exactly where the loaded page puts things, so nothing jumps when the numbers arrive. Run it after any change to markup, CSS or text length, at phone width.

## Publishing

The repository has no releases, so HACS follows the latest commit on `main`: every merge into `main` reaches every HACS install as an update. Run the preview checks before merging.

## Adding or fixing a language

Every text is in `dist/strings.js`. To add a language, copy the `en` object, name it with the language code, and translate it.

- Every key of `en` must be there.
- Each advice pool keeps the same number of lines, in the same order.
- A text must not contain a double quote, `<`, `>` or `&`: some go into HTML attributes.
- Advice lines must fit two rows on a phone. Tab names and the labels under the icons must stay short.
- Many texts are fragments joined in code (`runOn` with `src` and `and`, for example). Read how `solar-view.js` uses a key before translating it.

The preview checks the first three on every load. Open it with `?lang=` set to your language and look at every page.

Italian was revised by a native speaker. The other translations were not, and Dutch and Polish in particular have never been read by one.
