import { describe, it } from "node:test";
import { assertQueryLineConformance } from "@plurnk/plurnk-mimetypes/conformance";
import Handler from "./TextTerraform.ts";

// #41: structural matches carry source-line spans (coverage gate).
const h = new Handler({ mimetype: "text/x-hcl", glyph: "🏗️", extensions: [".tf", ".tfvars", ".hcl"] });

describe("#41 query-line conformance", () => {
    it("every structural match carries a source-line span", async () => {
        await assertQueryLineConformance(h, [
            { source: "resource \"aws_s3_bucket\" \"b\" {\n  bucket = \"x\"\n  acl = \"private\"\n}\n", dialect: "jsonpath", pattern: "$..*" },
        ]);
    });
});
