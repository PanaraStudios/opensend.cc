import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

/* Convex Cloud runs "use node" actions on Node 20 unless convex.json says
   otherwise, while self-hosted Convex and the images use the pinned Node. */
test("every runtime pins the same Node major", () => {
  const major = read(".nvmrc").trim().split(".")[0]
  assert.equal(JSON.parse(read("convex.json")).node.nodeVersion, major)
  assert.match(
    read("nixpacks.toml"),
    new RegExp(`NIXPACKS_NODE_VERSION = "${major}"`)
  )
  for (const file of [
    "Dockerfile",
    "docker/smtp/Dockerfile",
    "services/call-gateway/Dockerfile",
  ]) {
    const images = [...read(file).matchAll(/^FROM node:(\d+)\.\S+@sha256:/gm)]
    assert.ok(images.length, `${file} pins a Node image by digest`)
    for (const [, version] of images) assert.equal(version, major, file)
  }
})

test("the migrate image deploys with convex.json", () => {
  // Image-based Convex Cloud deploys (compose.cloud.yaml, install.sh) would
  // otherwise run Node actions on Convex's default Node 20.
  const dockerfile = read("Dockerfile")
  const migrate = dockerfile.slice(
    dockerfile.search(/^FROM \S+ AS migrate$/m),
    dockerfile.search(/^FROM \S+ AS build$/m)
  )
  assert.match(migrate, /^COPY\b.*\sconvex\.json\s.*\.\/$/m)
  assert.doesNotMatch(read(".dockerignore"), /^convex\.json$/m)
})
