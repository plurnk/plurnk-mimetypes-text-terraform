import { describe, it } from "node:test";
import assert from "node:assert/strict";
import TextTerraform from "./TextTerraform.ts";

const metadata = {
    mimetype: "text/x-hcl",
    glyph: "🏗️",
    extensions: [".tf", ".tfvars"] as const,
};

describe("TextTerraform — instantiation", () => {
    it("instantiates with metadata", () => {
        const h = new TextTerraform(metadata);
        assert.equal(h.mimetype, "text/x-hcl");
        assert.equal(h.glyph, "🏗️");
    });
});

describe("TextTerraform — extract", () => {
    it("extracts resource as TYPE.NAME class", () => {
        const h = new TextTerraform(metadata);
        const src = [
            "resource \"aws_instance\" \"web\" {",
            "    ami = \"ami-12345\"",
            "    instance_type = \"t2.micro\"",
            "}",
        ].join("\n");
        const syms = h.extractRaw(src);
        const r = syms.find((s) => s.name === "aws_instance.web");
        assert.ok(r);
        assert.equal(r.kind, "class");
    });

    it("extracts data source as data.TYPE.NAME class", () => {
        const h = new TextTerraform(metadata);
        const src = [
            "data \"aws_ami\" \"ubuntu\" {",
            "    most_recent = true",
            "}",
        ].join("\n");
        const syms = h.extractRaw(src);
        const d = syms.find((s) => s.name === "data.aws_ami.ubuntu");
        assert.ok(d);
        assert.equal(d.kind, "class");
    });

    it("extracts module as module kind", () => {
        const h = new TextTerraform(metadata);
        const src = [
            "module \"vpc\" {",
            "    source = \"./modules/vpc\"",
            "}",
        ].join("\n");
        const syms = h.extractRaw(src);
        const m = syms.find((s) => s.name === "vpc");
        assert.ok(m);
        assert.equal(m.kind, "module");
    });

    it("extracts provider as module kind", () => {
        const h = new TextTerraform(metadata);
        const src = [
            "provider \"aws\" {",
            "    region = \"us-east-1\"",
            "}",
        ].join("\n");
        const syms = h.extractRaw(src);
        const p = syms.find((s) => s.name === "aws");
        assert.ok(p);
        assert.equal(p.kind, "module");
    });

    it("extracts variable as variable kind", () => {
        const h = new TextTerraform(metadata);
        const src = [
            "variable \"region\" {",
            "    type = string",
            "    default = \"us-east-1\"",
            "}",
        ].join("\n");
        const syms = h.extractRaw(src);
        const v = syms.find((s) => s.name === "region");
        assert.ok(v);
        assert.equal(v.kind, "variable");
    });

    it("extracts output as constant kind", () => {
        const h = new TextTerraform(metadata);
        const src = [
            "output \"public_ip\" {",
            "    value = aws_instance.web.public_ip",
            "}",
        ].join("\n");
        const syms = h.extractRaw(src);
        const o = syms.find((s) => s.name === "public_ip");
        assert.ok(o);
        assert.equal(o.kind, "constant");
    });

    it("returns empty array for empty input", () => {
        const h = new TextTerraform(metadata);
        assert.deepEqual(h.extractRaw(""), []);
    });

    it("does not throw on malformed source", () => {
        const h = new TextTerraform(metadata);
        assert.doesNotThrow(() => h.extractRaw("resource { broken"));
        assert.doesNotThrow(() => h.extractRaw("@@ bogus"));
    });
});

describe("TextTerraform — framework integration", () => {
    it("renders extracted hierarchy via format()", () => {
        const h = new TextTerraform(metadata);
        const src = "resource \"aws_s3_bucket\" \"logs\" { bucket = \"logs\" }";
        const out = h.symbolsRaw(src);
        assert.ok(out.includes("aws_s3_bucket.logs"));
    });

    it("inherits jsonpath query against the symbol outline", async () => {
        const h = new TextTerraform(metadata);
        const src = "variable \"region\" { default = \"us-east-1\" }";
        const r = await h.query(src, "jsonpath", "$.region");
        assert.equal(r.length, 1);
    });
});

// Real-world smoke against a representative Terraform stack — VPC + EC2 +
// outputs.
describe("TextTerraform — real-world smoke (AWS VPC stack)", () => {
    const SRC = [
        "provider \"aws\" {",
        "    region = var.region",
        "}",
        "",
        "variable \"region\" {",
        "    type = string",
        "    default = \"us-east-1\"",
        "}",
        "",
        "variable \"instance_count\" {",
        "    type = number",
        "    default = 3",
        "}",
        "",
        "data \"aws_ami\" \"ubuntu\" {",
        "    most_recent = true",
        "    owners = [\"099720109477\"]",
        "}",
        "",
        "resource \"aws_vpc\" \"main\" {",
        "    cidr_block = \"10.0.0.0/16\"",
        "}",
        "",
        "resource \"aws_subnet\" \"public\" {",
        "    vpc_id = aws_vpc.main.id",
        "    cidr_block = \"10.0.1.0/24\"",
        "}",
        "",
        "resource \"aws_instance\" \"web\" {",
        "    ami = data.aws_ami.ubuntu.id",
        "    instance_type = \"t2.micro\"",
        "    subnet_id = aws_subnet.public.id",
        "}",
        "",
        "module \"monitoring\" {",
        "    source = \"./modules/monitoring\"",
        "}",
        "",
        "output \"web_public_ip\" {",
        "    value = aws_instance.web.public_ip",
        "}",
        "",
        "output \"vpc_id\" {",
        "    value = aws_vpc.main.id",
        "}",
    ].join("\n");

    it("surfaces all declarations with kind-discriminated names", () => {
        const h = new TextTerraform(metadata);
        const syms = h.extractRaw(SRC);
        const byNameKind = new Map(syms.map((s) => [`${s.name}:${s.kind}`, s]));

        assert.ok(byNameKind.has("aws:module"));
        assert.ok(byNameKind.has("region:variable"));
        assert.ok(byNameKind.has("instance_count:variable"));
        assert.ok(byNameKind.has("data.aws_ami.ubuntu:class"));
        assert.ok(byNameKind.has("aws_vpc.main:class"));
        assert.ok(byNameKind.has("aws_subnet.public:class"));
        assert.ok(byNameKind.has("aws_instance.web:class"));
        assert.ok(byNameKind.has("monitoring:module"));
        assert.ok(byNameKind.has("web_public_ip:constant"));
        assert.ok(byNameKind.has("vpc_id:constant"));
    });
});
