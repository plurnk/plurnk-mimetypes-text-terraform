import { TreeSitterExtractor, collectReferences } from "@plurnk/plurnk-mimetypes";
import type {
    HandlerContent,
    MimeRef,
    MimeSymbol,
    TreeSitterNode,
    TreeSitterParser,
    TreeSitterTree,
} from "@plurnk/plurnk-mimetypes";
import { extract } from "./hcl.ts";
import HclRefsQuery from "./HclRefsQuery.ts";
import type { HclRawQuery } from "./HclRefsQuery.ts";
import { refsQuery } from "./queries/hcl.ts";

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
    // Retained by loadParser for the references channel — Query compilation
    // needs the Language object and the Query constructor, not the parser
    // (same pattern as the framework's TreeSitterLanguageHandler).
    #language: unknown = null;
    #QueryCtor: (new (language: unknown, source: string) => HclRawQuery) | null = null;
    #refsQuery: HclRefsQuery | null = null;

    protected async loadParser(): Promise<TreeSitterParser> {
        const ts = await import("web-tree-sitter" as string) as {
            Parser: {
                init(): Promise<void>;
                new (): { setLanguage(lang: unknown): void; parse(content: string): unknown };
            };
            Language: {
                load(wasmPath: string): Promise<unknown>;
            };
            Query: new (language: unknown, source: string) => HclRawQuery;
        };
        await ts.Parser.init();
        const wasmUrl = new URL("../hcl.wasm", import.meta.url);
        const lang = await ts.Language.load(wasmUrl.pathname);
        this.#language = lang;
        this.#QueryCtor = ts.Query;
        const parser = new ts.Parser();
        parser.setLanguage(lang);
        return parser as unknown as TreeSitterParser;
    }

    protected extractFromTree(tree: TreeSitterTree, _content: HandlerContent): MimeSymbol[] {
        return extract(tree.rootNode);
    }

    // References channel (framework SPEC §16). Executes the HCL refs query
    // via the framework's collectReferences engine; containers resolve
    // against the same defs extract() emits. Error policy mirrors the
    // framework's TreeSitterLanguageHandler: parse/query failures route to
    // an empty channel.
    override async references(content: HandlerContent): Promise<MimeRef[]> {
        if (typeof content !== "string") return [];
        let parser: TreeSitterParser;
        try {
            parser = await this.getParser();
        } catch {
            return [];
        }
        const query = this.#getRefsQuery();
        let tree: TreeSitterTree | null;
        try {
            tree = parser.parse(content);
            if (!tree) return [];
        } catch {
            return [];
        }
        try {
            return collectReferences(query, tree, extract(tree.rootNode));
        } catch {
            return [];
        } finally {
            tree.delete?.();
        }
    }

    // Compiled-query cache: the query source is constant, so compile once
    // per handler lifetime. A primed parser guarantees loadParser retained
    // the Language + Query constructor.
    #getRefsQuery(): HclRefsQuery {
        if (this.#refsQuery === null) {
            if (this.#language === null || this.#QueryCtor === null) {
                throw new Error("internal: references() before loadParser primed the language");
            }
            this.#refsQuery = new HclRefsQuery(new this.#QueryCtor(this.#language, refsQuery));
        }
        return this.#refsQuery;
    }
}
