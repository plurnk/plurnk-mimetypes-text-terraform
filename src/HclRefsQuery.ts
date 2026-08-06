import type { RefsCaptureNode, RefsQuery, RefsQueryCapture, TreeSitterNode } from "@plurnk/plurnk-mimetypes";

// Adapts a compiled web-tree-sitter Query to the framework's RefsQuery
// surface. HCL needs match-level composition the engine's flat captures()
// can't express: resource defs are named "TYPE.NAME" (data defs
// "data.TYPE.NAME"), so a joinable ref row must compose multiple capture
// nodes into one qualified name. We run matches() and emit one engine
// capture per match, synthesizing a span node for the composed shapes.
//
// Capture roles (see queries/hcl.ts):
//   ref.use             → emitted verbatim (var/local/module attr name)
//   data.root/type/name → composed "data.TYPE.NAME"
//   res.type/name       → composed "TYPE.NAME"

// Raw query surface we consume — matches(), not captures(). Duck-typed
// locally (framework pattern) so this package's types don't depend on
// web-tree-sitter's.
export interface HclRawQuery {
    matches(node: TreeSitterNode): ReadonlyArray<{
        captures: ReadonlyArray<{ name: string; node: TreeSitterNode }>;
    }>;
}

export default class HclRefsQuery implements RefsQuery {
    readonly #query: HclRawQuery;

    constructor(query: HclRawQuery) {
        this.#query = query;
    }

    captures(node: TreeSitterNode): RefsQueryCapture[] {
        const out: RefsQueryCapture[] = [];
        for (const { captures } of this.#query.matches(node)) {
            const byName = new Map(captures.map((c) => [c.name, c.node]));
            const direct = byName.get("ref.use");
            if (direct) {
                out.push({ name: "ref.use", node: direct });
                continue;
            }
            const dataRoot = byName.get("data.root");
            const dataType = byName.get("data.type");
            const dataName = byName.get("data.name");
            if (dataRoot && dataType && dataName) {
                out.push(span(`data.${dataType.text}.${dataName.text}`, dataRoot, dataName));
                continue;
            }
            const resType = byName.get("res.type");
            const resName = byName.get("res.name");
            if (resType && resName) {
                out.push(span(`${resType.text}.${resName.text}`, resType, resName));
            }
        }
        return out;
    }
}

// Span node covering the composed qualified name. RefsCaptureNode (issue #26)
// is exactly the {text,startPosition,endPosition} surface the engine reads, so
// this is an honest construction — no cast through TreeSitterNode.
function span(text: string, start: TreeSitterNode, end: TreeSitterNode): RefsQueryCapture {
    if (start.startIndex === undefined || end.endIndex === undefined) {
        throw new Error("HCL reference capture lacks native source offsets");
    }
    const node: RefsCaptureNode = {
        text,
        startIndex: start.startIndex,
        endIndex: end.endIndex,
        startPosition: start.startPosition,
        endPosition: end.endPosition,
    };
    return { name: "ref.use", node };
}
