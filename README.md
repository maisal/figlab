# figlab

figlab is a graph tool that runs in the browser. It has two goals:

- Plot CSV and similar files quickly, as a first check of measurement data.
- Make figures that are good enough for papers.

Everything runs in your browser. Your data is never sent to a server.
A command line tool, `figlab`, gives the same results as the browser app.

## Status

figlab is at the start of implementation. The foundation is done (roadmap.md M0):

- The command language is fixed for the MVP: [language.md](docs/language.md), [spec/commands.json](spec/commands.json), [spec/errors.json](spec/errors.json), and the first [conformance tests](tests/lang).
- The Rust workspace and the web app have empty skeletons. CI checks every pull request.

The app does not do anything useful yet. The documents below describe what will be built.

## Development

The tools are pinned with [mise](https://mise.jdx.dev). History is managed with [jj](https://jj-vcs.github.io/jj/).

```sh
mise install       # install the pinned tools
mise run check     # run all checks; they must pass before you push
mise run dev       # start the web app locally
```

## Documents

- [Requirements](docs/draft.md)
- [Specification](docs/spec.md)
- [Command language](docs/language.md)
- [Development process](docs/development.md)
- [Roadmap to the MVP](docs/roadmap.md)

## Contributing

Read [AGENTS.md](AGENTS.md) and the [development process](docs/development.md) before you start.
To report a security problem, see [SECURITY.md](SECURITY.md).

## License

Licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT license ([LICENSE-MIT](LICENSE-MIT))

at your option.

### Contribution

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in the work by you, as defined in the Apache-2.0 license, shall be
dual licensed as above, without any additional terms or conditions.
