import { describe, it } from "node:test";
import assert from "node:assert/strict";
import TextTerraform from "./TextTerraform.ts";

// Conformance-style suite for the references channel (framework SPEC §16).
// Reproduces the framework's test/conformance/harness.ts invariants inline —
// the harness isn't importable across repos.

const metadata = {
    mimetype: "text/x-terraform",
    glyph: "🏗️",
    extensions: [".tf", ".tfvars"] as const,
};

const SOURCE = `variable "region" { type = string }
variable "instance_type" { type = string }

locals {
  name_prefix = "app"
}

data "aws_ami" "ubuntu" {
  most_recent = true
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  # CommentDecoy: var.fake_comment aws_vpc.fake
}

resource "aws_subnet" "public" {
  vpc_id = aws_vpc.main.id
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = var.instance_type
  subnet_id     = aws_subnet.public.id
  name          = "\${var.region}-suffix"
  zone          = each.value
  idx           = count.index
  fn            = length(var.region)
  note          = "StringDecoy var.fake_string"
  prefix        = local.name_prefix
}

module "monitoring" {
  source = "./modules/monitoring"
  vpc_id = aws_vpc.main.id
}

output "web_ip" {
  value = aws_instance.web.public_ip
}

output "dashboard" {
  value = module.monitoring.dashboard_url
}
`;

// Substrings that appear ONLY inside string literals or comments — none may
// surface as a ref name.
const DECOYS = ["fake_comment", "fake_string", "fake", "CommentDecoy", "StringDecoy"];

// (container, name) edges that must join: ref.name matches a local def name
// AND ref.container equals an emitted def path.
const JOINS = [
    // resource attr → resource def
    { refName: "aws_vpc.main", container: "aws_subnet.public" },
    // resource attr → data def
    { refName: "data.aws_ami.ubuntu", container: "aws_instance.web" },
    // resource attr → variable def
    { refName: "instance_type", container: "aws_instance.web" },
    // interpolation → variable def
    { refName: "region", container: "aws_instance.web" },
    // module block attr → resource def
    { refName: "aws_vpc.main", container: "monitoring" },
    // output → resource def
    { refName: "aws_instance.web", container: "web_ip" },
    // output → module def
    { refName: "monitoring", container: "dashboard" },
];

describe("conformance: text/x-terraform refs (SPEC §16 invariants, inline)", () => {
    it("passes the shared invariants and expected joins", async () => {
        const h = new TextTerraform(metadata);
        const symbols = await h.extractRaw(SOURCE);
        const references = await h.references(SOURCE);

        assert.ok(references.length > 0, "fixture must produce at least one ref");

        const defPaths = new Set(
            symbols.map((s) => (s.container !== undefined ? `${s.container}.${s.name}` : s.name)),
        );
        const defNames = new Set(symbols.map((s) => s.name));

        for (const ref of references) {
            const label = `${ref.kind} ${ref.name} @${ref.line}:${ref.column}`;
            // 1-indexed positions, sane ranges, columns always present.
            assert.ok(ref.line >= 1, `1-indexed line: ${label}`);
            assert.ok(ref.column >= 1, `1-indexed column: ${label}`);
            assert.ok(ref.endLine >= ref.line, `endLine >= line: ${label}`);
            assert.equal(typeof ref.endColumn, "number", `endColumn present: ${label}`);
            // Every container names an enclosing def emitted by this entry.
            if (ref.container !== undefined) {
                assert.ok(
                    defPaths.has(ref.container),
                    `container "${ref.container}" must be an emitted def path: ${label}`,
                );
            }
            // No definitions in the refs stream.
            const collidingDef = symbols.find(
                (s) => s.name === ref.name && s.line === ref.line && s.column === ref.column,
            );
            assert.equal(collidingDef, undefined, `ref must not be a def's own name node: ${label}`);
        }

        // Deterministic document order.
        for (let i = 1; i < references.length; i += 1) {
            const prev = references[i - 1];
            const cur = references[i];
            assert.ok(
                cur.line > prev.line || (cur.line === prev.line && cur.column >= prev.column),
                `document order violated at index ${i}`,
            );
        }

        // String/comment decoys never surface.
        for (const decoy of DECOYS) {
            assert.ok(
                !references.some((r) => r.name === decoy),
                `decoy "${decoy}" (string/comment content) surfaced as a ref`,
            );
        }

        // The service's join works on real output.
        for (const join of JOINS) {
            const ref = references.find(
                (r) => r.name === join.refName && r.container === join.container,
            );
            assert.ok(
                ref,
                `expected join ref "${join.refName}" with container "${join.container}"; `
                + `got: ${JSON.stringify(references.map((r) => ({ n: r.name, c: r.container })))}`,
            );
            assert.ok(defNames.has(join.refName), `join target "${join.refName}" must be a local def`);
        }

        // HCL emits use-kind only — every cross-block reference is a
        // declared dependency.
        assert.ok(references.every((r) => r.kind === "use"));

        // Builtin object roots (each/count/self/path/terraform) are
        // structurally excluded — not name-joinable.
        assert.ok(!references.some((r) => ["each", "count", "value", "index"].includes(r.name)));

        // Function calls are Terraform builtins — never captured. Their
        // arguments still surface (var.region inside length()).
        assert.ok(!references.some((r) => r.name === "length"));
        assert.ok(references.some((r) => r.name === "region" && r.line === 28));

        // local.NAME rows are honest dead rows: present, but never join —
        // the mapping doesn't emit locals.
        const localRef = references.find((r) => r.name === "name_prefix");
        assert.ok(localRef, "local.name_prefix must surface as a ref");
        assert.ok(!defNames.has("name_prefix"));
    });

    it("composed resource refs carry the full TYPE.NAME span", async () => {
        const h = new TextTerraform(metadata);
        const references = await h.references('output "ip" { value = aws_instance.web.public_ip }\n');
        const ref = references.find((r) => r.name === "aws_instance.web");
        assert.ok(ref);
        assert.equal(ref.line, 1);
        assert.equal(ref.column, 23);
        // Span covers "aws_instance.web", not the trailing ".public_ip".
        assert.equal(ref.endColumn, 23 + "aws_instance.web".length);
        assert.equal(ref.kind, "use");
        assert.equal(ref.container, "ip");
    });

    it("composed resource refs use native indexes across preceding Unicode", async () => {
        const h = new TextTerraform(metadata);
        const prefix = 'output "😀e\u0301" { value = ';
        const references = await h.references(`${prefix}aws_instance.web.public_ip }\n`);
        const ref = references.find((candidate) => candidate.name === "aws_instance.web");
        const expectedColumn = Array.from(prefix).length + 1;
        assert.ok(ref);
        assert.deepEqual({
            line: ref.line,
            column: ref.column,
            endLine: ref.endLine,
            endColumn: ref.endColumn,
            container: ref.container,
        }, {
            line: 1,
            column: expectedColumn,
            endLine: 1,
            endColumn: expectedColumn + Array.from("aws_instance.web").length,
            container: "😀e\u0301",
        });
    });

    it("non-string and malformed content route to an empty channel", async () => {
        const h = new TextTerraform(metadata);
        assert.deepEqual(await h.references(new Uint8Array([1, 2, 3])), []);
        assert.deepEqual(await h.references(""), []);
        await assert.doesNotReject(h.references("resource { broken"));
    });
});
