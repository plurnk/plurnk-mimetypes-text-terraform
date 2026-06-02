import { AntlrExtractor, withExtractor } from "@plurnk/plurnk-mimetypes";
import type { ExtractionVisitor } from "@plurnk/plurnk-mimetypes";
import { CharStream, CommonTokenStream } from "antlr4ng";
import { terraformLexer } from "./generated/terraformLexer.ts";
import { terraformParser } from "./generated/terraformParser.ts";
import { terraformVisitor } from "./generated/terraformVisitor.ts";

// application/x-hcl handler. ANTLR grammar from grammars-v4/terraform.
//
// Parser entry rule: file_ → (local | module | output | provider | variable |
// data | resource | terraform)+ EOF
export default class TextTerraform extends AntlrExtractor {
    protected parseTree(content: string): unknown {
        const lexer = new terraformLexer(CharStream.fromString(content));
        const tokens = new CommonTokenStream(lexer);
        const parser = new terraformParser(tokens);
        parser.removeErrorListeners();
        return parser.file_();
    }

    protected createVisitor(): ExtractionVisitor {
        return new TextTerraformVisitor() as unknown as ExtractionVisitor;
    }
}

// SPEC §3 mapping for Terraform HCL:
//   resource TYPE NAME { ... }   → class (rendered as `TYPE.NAME` —
//                                  Terraform's canonical reference form)
//   data TYPE NAME { ... }       → class (rendered as `data.TYPE.NAME`)
//   module NAME { ... }          → module
//   provider TYPE { ... }        → module
//   variable NAME { ... }        → variable
//   output NAME { ... }          → constant (outputs are read-only exports)
//   locals { ... }               → not surfaced as a single symbol (the
//                                  contained bindings would each need
//                                  argument extraction; deferred)
//   terraform { ... }            → not surfaced
class TextTerraformVisitor extends withExtractor(terraformVisitor) {
    visitResource = (ctx: any): null => {
        if (this.inBody) return null;
        const type = unquoteString(ctx.resourcetype?.()?.getText?.());
        const name = unquoteString(ctx.name?.()?.getText?.());
        if (type && name) this.addSymbol("class", `${type}.${name}`, ctx);
        return null;
    };

    visitData = (ctx: any): null => {
        if (this.inBody) return null;
        const type = unquoteString(ctx.resourcetype?.()?.getText?.());
        const name = unquoteString(ctx.name?.()?.getText?.());
        if (type && name) this.addSymbol("class", `data.${type}.${name}`, ctx);
        return null;
    };

    visitModule = (ctx: any): null => {
        if (this.inBody) return null;
        const name = unquoteString(ctx.name?.()?.getText?.());
        if (name) this.addSymbol("module", name, ctx);
        return null;
    };

    visitProvider = (ctx: any): null => {
        if (this.inBody) return null;
        const type = unquoteString(ctx.resourcetype?.()?.getText?.());
        if (type) this.addSymbol("module", type, ctx);
        return null;
    };

    visitVariable = (ctx: any): null => {
        if (this.inBody) return null;
        const name = unquoteString(ctx.name?.()?.getText?.());
        if (name) this.addSymbol("variable", name, ctx);
        return null;
    };

    visitOutput = (ctx: any): null => {
        if (this.inBody) return null;
        const name = unquoteString(ctx.name?.()?.getText?.());
        if (name) this.addSymbol("constant", name, ctx);
        return null;
    };
}

function unquoteString(s: string | undefined | null): string | null {
    if (!s) return null;
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
    return s;
}
