// dsh-polish — client (browser) half.
//
// Written in the shipped-bundle form: `window.__ModuleLoader__.load({id, factory})`
// so the factory receives the module system's `require` and can pull React out of
// the shell's seed table. The row id ("dsh-polish") is the package name, which is
// what makes dsh-client-modules mount this half on the `dsh-polish` Loader row.
//
// Responsibilities:
//   1. the thinking-renderer DOM engine (component A), configured live from the
//      `dsh-polish:thinking-renderer` settings namespace;
//   2. the per-row configuration pages of every component, registered into the
//      Plugins page's keyed `plugins.row.config` slot as
//      `<bundle package>#<row id>`.
//
// All user-facing copy goes through t() (shared/i18n.js): the dictionaries are
// generated from locale/zh.jsonc + locale/en.jsonc (JSONC, language = file name)
// at build time, and the active language follows the DSH client locale service
// (ctx.locale, injected on this bundle); a missing entry falls back zh → key.
window.__ModuleLoader__.load({
  id: 'dsh-polish',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

