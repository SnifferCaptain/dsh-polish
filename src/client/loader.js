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
// All user-facing copy is Simplified Chinese and hard-coded on purpose: a bundle
// outside the app tree has no locale dictionary seat of its own, and the host
// falls back to raw keys when a dictionary is missing.
window.__ModuleLoader__.load({
  id: 'dsh-polish',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

