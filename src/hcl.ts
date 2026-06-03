import type { MimeSymbol, SymbolKind, TreeSitterNode } from "@plurnk/plurnk-mimetypes";

// HCL SPEC §3 mapping for tree-sitter-hcl.
//
// HCL's structure is uniform: every top-level construct is a `block` with a
// leading `identifier` (the block type) followed by zero or more `string_lit`
// labels and a `body`. We discriminate by the leading identifier:
//
//   resource "TYPE" "NAME"   → class, name "TYPE.NAME"      (Terraform)
//   data     "TYPE" "NAME"   → class, name "data.TYPE.NAME"  (Terraform)
//   module   "NAME"          → module
//   provider "TYPE"          → module
//   variable "NAME"          → variable
//   output   "NAME"          → constant (read-only export)
//   source   "TYPE" "NAME"   → class, name "TYPE.NAME"      (Packer)
//   build    (no labels)     → module, name "build"        (Packer)
//   packer / terraform / locals → not surfaced (config-level, no useful name)
//
// Same mapping for text/x-hcl and text/x-terraform — the handler class
// registers both mimetypes, but extraction logic is HCL-uniform.
export function extract(root: TreeSitterNode): MimeSymbol[] {
    const out: MimeSymbol[] = [];
    const body = findChildOfType(root, "body");
    if (!body) return out;
    for (let i = 0; i < body.namedChildCount; i += 1) {
        const child = body.namedChild(i);
        if (!child || child.type !== "block") continue;
        handleBlock(child, out);
    }
    return out;
}

function handleBlock(block: TreeSitterNode, out: MimeSymbol[]): void {
    // First named child is the block's leading identifier (resource, data,
    // module, etc.). Subsequent string_lit children are the labels.
    const head = block.namedChild(0);
    if (!head || head.type !== "identifier") return;
    const blockType = head.text;

    const labels: string[] = [];
    for (let i = 1; i < block.namedChildCount; i += 1) {
        const child = block.namedChild(i);
        if (!child) continue;
        if (child.type === "string_lit") {
            const text = stringLitText(child);
            if (text) labels.push(text);
        }
    }

    const line = block.startPosition.row + 1;
    const endLine = block.endPosition.row + 1;

    switch (blockType) {
        case "resource":
            if (labels.length >= 2) {
                out.push({ name: `${labels[0]}.${labels[1]}`, kind: "class", line, endLine });
            }
            return;
        case "data":
            if (labels.length >= 2) {
                out.push({ name: `data.${labels[0]}.${labels[1]}`, kind: "class", line, endLine });
            }
            return;
        case "source":
            if (labels.length >= 2) {
                out.push({ name: `${labels[0]}.${labels[1]}`, kind: "class", line, endLine });
            }
            return;
        case "module":
            if (labels.length >= 1) {
                out.push({ name: labels[0], kind: "module", line, endLine });
            }
            return;
        case "provider":
            if (labels.length >= 1) {
                out.push({ name: labels[0], kind: "module", line, endLine });
            }
            return;
        case "variable":
            if (labels.length >= 1) {
                out.push({ name: labels[0], kind: "variable", line, endLine });
            }
            return;
        case "output":
            if (labels.length >= 1) {
                out.push({ name: labels[0], kind: "constant", line, endLine });
            }
            return;
        case "build":
            out.push({ name: "build", kind: "module", line, endLine });
            return;
        default:
            // packer / terraform / locals / etc. — config-level blocks
            // without a meaningful navigable name; not surfaced.
            return;
    }
}

// string_lit wraps quoted_template_start + template_literal + quoted_template_end.
// We need the template_literal's text — the unquoted string content.
function stringLitText(node: TreeSitterNode): string | null {
    for (let i = 0; i < node.namedChildCount; i += 1) {
        const child = node.namedChild(i);
        if (child && child.type === "template_literal") return child.text;
    }
    return null;
}

function findChildOfType(node: TreeSitterNode, type: string): TreeSitterNode | null {
    for (let i = 0; i < node.namedChildCount; i += 1) {
        const child = node.namedChild(i);
        if (child && child.type === type) return child;
    }
    return null;
}
