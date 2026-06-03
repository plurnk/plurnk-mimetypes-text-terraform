import { TreeSitterExtractor } from "@plurnk/plurnk-mimetypes";
import type {
    HandlerContent,
    MimeSymbol,
    TreeSitterNode,
    TreeSitterParser,
    TreeSitterTree,
} from "@plurnk/plurnk-mimetypes";
import { extract } from "./hcl.ts";

// text/x-hcl + text/x-terraform handler. Tier 2 since v1.0.0 — was ANTLR
// from 0.1.0 through 0.3.0; promoted to tree-sitter-hcl when the community
// grammar matured to cleanly parse Terraform + Packer + other HCL dialects.
//
// One handler class serves both registered mimetypes (text/x-hcl and
// text/x-terraform). The extraction logic is identical across them — HCL is
// HCL — but the two mimetypes coexist so consumers can route by intent
// (generic HCL config vs. Terraform-specific) when that distinction matters
// to them.
export default class TextTerraform extends TreeSitterExtractor {
    protected async loadParser(): Promise<TreeSitterParser> {
        const ts = await import("web-tree-sitter" as string) as {
            Parser: {
                init(): Promise<void>;
                new (): { setLanguage(lang: unknown): void; parse(content: string): unknown };
            };
            Language: {
                load(wasmPath: string): Promise<unknown>;
            };
        };
        await ts.Parser.init();
        const wasmUrl = new URL("../hcl.wasm", import.meta.url);
        const lang = await ts.Language.load(wasmUrl.pathname);
        const parser = new ts.Parser();
        parser.setLanguage(lang);
        return parser as unknown as TreeSitterParser;
    }

    protected extractFromTree(tree: TreeSitterTree, _content: HandlerContent): MimeSymbol[] {
        return extract(tree.rootNode);
    }
}
