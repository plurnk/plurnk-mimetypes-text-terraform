import { describe, it } from "node:test";
import assert from "node:assert/strict";
import TextTerraform from "./TextTerraform.ts";

const metadata = {
    mimetype: "text/x-hcl",
    glyph: "🏗️",
    extensions: [".tf", ".tfvars", ".hcl"] as const,
};

describe("TextTerraform — instantiation", () => {
    it("instantiates with metadata", () => {
        const h = new TextTerraform(metadata);
        assert.equal(h.mimetype, "text/x-hcl");
        assert.equal(h.glyph, "🏗️");
    });
});

describe("TextTerraform — Terraform blocks", () => {
    it("resource → TYPE.NAME class", async () => {
        const h = new TextTerraform(metadata);
        const syms = await h.extractRaw('resource "aws_instance" "web" { ami = "ami-12345" }\n');
        assert.equal(syms.find((s) => s.name === "aws_instance.web")?.kind, "class");
    });

    it("data → data.TYPE.NAME class", async () => {
        const h = new TextTerraform(metadata);
        const syms = await h.extractRaw('data "aws_ami" "ubuntu" { most_recent = true }\n');
        assert.equal(syms.find((s) => s.name === "data.aws_ami.ubuntu")?.kind, "class");
    });

    it("module → module", async () => {
        const h = new TextTerraform(metadata);
        const syms = await h.extractRaw('module "vpc" { source = "./modules/vpc" }\n');
        assert.equal(syms.find((s) => s.name === "vpc")?.kind, "module");
    });

    it("provider → module", async () => {
        const h = new TextTerraform(metadata);
        const syms = await h.extractRaw('provider "aws" { region = "us-east-1" }\n');
        assert.equal(syms.find((s) => s.name === "aws")?.kind, "module");
    });

    it("variable → variable", async () => {
        const h = new TextTerraform(metadata);
        const syms = await h.extractRaw('variable "region" { type = string }\n');
        assert.equal(syms.find((s) => s.name === "region")?.kind, "variable");
    });

    it("output → constant", async () => {
        const h = new TextTerraform(metadata);
        const syms = await h.extractRaw('output "public_ip" { value = aws_instance.web.public_ip }\n');
        assert.equal(syms.find((s) => s.name === "public_ip")?.kind, "constant");
    });

    it("terraform/locals/packer config blocks don't surface symbols", async () => {
        const h = new TextTerraform(metadata);
        const syms = await h.extractRaw(
            'terraform { required_version = ">= 1.0" }\nlocals { env = "prod" }\n',
        );
        // No symbols for top-level config-only blocks.
        assert.equal(syms.length, 0);
    });
});

describe("TextTerraform — Packer blocks (HCL2)", () => {
    it("source → TYPE.NAME class", async () => {
        const h = new TextTerraform(metadata);
        const syms = await h.extractRaw('source "amazon-ebs" "ubuntu" { region = "us-east-1" }\n');
        assert.equal(syms.find((s) => s.name === "amazon-ebs.ubuntu")?.kind, "class");
    });

    it("build → module 'build'", async () => {
        const h = new TextTerraform(metadata);
        const syms = await h.extractRaw('build { sources = ["source.amazon-ebs.ubuntu"] }\n');
        assert.equal(syms.find((s) => s.name === "build")?.kind, "module");
    });
});

describe("TextTerraform — error handling", () => {
    it("empty input → []", async () => {
        const h = new TextTerraform(metadata);
        assert.deepEqual(await h.extractRaw(""), []);
    });

    it("doesn't throw on malformed source", async () => {
        const h = new TextTerraform(metadata);
        await assert.doesNotReject(h.extractRaw("resource { broken"));
        await assert.doesNotReject(h.extractRaw("@@ bogus"));
    });

    it("binary content → []", async () => {
        const h = new TextTerraform(metadata);
        assert.deepEqual(await h.extractRaw(new Uint8Array([1, 2, 3])), []);
    });
});

describe("TextTerraform — framework integration", () => {
    it("renders extracted hierarchy via format()", async () => {
        const h = new TextTerraform(metadata);
        const out = await h.symbolsRaw('resource "aws_s3_bucket" "logs" { bucket = "logs" }\n');
        assert.ok(out.includes("aws_s3_bucket.logs"));
    });

    it("jsonpath dispatches against the deep-json tree-sitter parse tree (issue #10)", async () => {
        const h = new TextTerraform(metadata);
        const roots = await h.query(
            'resource "aws_instance" "x" { ami = "y" }\n',
            "jsonpath",
            "$.type",
        );
        assert.equal(roots.length, 1);
        assert.equal(roots[0].matched, "config_file");
    });
});

describe("TextTerraform — real-world smoke (AWS VPC stack)", () => {
    const SRC = [
        'provider "aws" { region = var.region }',
        'variable "region" { type = string }',
        'variable "instance_count" { type = number }',
        'data "aws_ami" "ubuntu" { most_recent = true }',
        'resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }',
        'resource "aws_subnet" "public" { vpc_id = aws_vpc.main.id }',
        'resource "aws_instance" "web" { ami = data.aws_ami.ubuntu.id }',
        'module "monitoring" { source = "./modules/monitoring" }',
        'output "web_public_ip" { value = aws_instance.web.public_ip }',
        'output "vpc_id" { value = aws_vpc.main.id }',
    ].join("\n");

    it("surfaces all declarations with kind-discriminated names", async () => {
        const h = new TextTerraform(metadata);
        const syms = await h.extractRaw(SRC);
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

describe("TextTerraform — parser coordinates", () => {
    it("materializes native spans across LF, CRLF, and CR-only records with Unicode", async () => {
        const firstLine = "variable \"😀e\u0301\" {}";
        for (const separator of ["\n", "\r\n", "\r"]) {
            const h = new TextTerraform(metadata);
            const symbols = await h.extractRaw(`${firstLine}${separator}output "x" {}`);
            const first = symbols.find((symbol) => symbol.name === "😀e\u0301");
            const second = symbols.find((symbol) => symbol.name === "x");
            assert.deepEqual(first && {
                line: first.line,
                column: first.column,
                endLine: first.endLine,
                endColumn: first.endColumn,
            }, {
                line: 1,
                column: 1,
                endLine: 1,
                endColumn: Array.from(firstLine).length + 1,
            });
            assert.deepEqual(second && {
                line: second.line,
                column: second.column,
            }, { line: 2, column: 1 });
        }
    });
});
