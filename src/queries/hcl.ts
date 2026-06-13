// References query for tree-sitter-hcl (framework SPEC §16; mirrors the
// framework's src/treesitter/queries/{slug}.ts convention). HCL/Terraform is
// a pure dependency-graph DSL: every cross-block reference is a declared
// dependency, so everything classifies as `use` (the make precedent — these
// are edges Terraform itself resolves, not bare identifier reads).
//
// A reference is `(variable_expr (identifier)) (get_attr (identifier))*`
// siblings under a varying parent — `expression` usually, but operands of
// binary/unary operations hold the pair DIRECTLY (no expression wrapper),
// hence the wildcard `(_ ...)` parent. Interpolations `"${var.x}-y"` and
// heredoc `${...}` are parsed expression nodes, so they match for free;
// plain string/heredoc/comment content is template_literal/comment text and
// can never match an identifier pattern.
//
// Three root shapes, discriminated by the leading identifier:
//   - var/local/module roots → capture the FIRST attr name alone: the
//     mapping names those defs "NAME" (variables, modules). `local.NAME`
//     rows are honest but never join today — the mapping doesn't surface
//     locals (config-level block).
//   - data.TYPE.NAME → both attrs; the handler composes "data.TYPE.NAME"
//     to match the mapping's data def names (see HclRefsQuery).
//   - TYPE.NAME resource refs (root not a builtin object) → both segments;
//     composed to "TYPE.NAME" to match resource/source def names.
//
// Excluded by predicate: each/count/self/path/terraform builtin object
// roots — not name-joinable. Function calls (`length(...)`, `format(...)`)
// are Terraform builtins, equally un-joinable — never captured (their
// arguments still match as ordinary expressions).
export const refsQuery = `
(_
  (variable_expr (identifier) @_root)
  .
  (get_attr (identifier) @ref.use)
  (#any-of? @_root "var" "local" "module"))

(_
  (variable_expr (identifier) @data.root)
  .
  (get_attr (identifier) @data.type)
  .
  (get_attr (identifier) @data.name)
  (#eq? @data.root "data"))

(_
  (variable_expr (identifier) @res.type)
  .
  (get_attr (identifier) @res.name)
  (#not-any-of? @res.type
    "var" "local" "module" "data"
    "each" "count" "self" "path" "terraform"))
`;
