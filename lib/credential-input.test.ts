import assert from "node:assert/strict"
import { test } from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Input } from "../components/ui/input"
import { credentialInputProps } from "./credential-input"

test("credential IDs and secrets discourage browsers and password managers", () => {
  for (const secret of [false, true]) {
    const props = credentialInputProps(secret)
    assert.equal(props.autoComplete, secret ? "new-password" : "off")
    assert.equal(props["data-1p-ignore"], true)
    assert.equal(props["data-lpignore"], "true")
    assert.equal(props["data-bwignore"], "true")
    assert.equal(props.spellCheck, false)
  }
})

test("shared Input applies credential protection after caller attributes", () => {
  for (const type of ["text", "password"]) {
    const html = renderToStaticMarkup(
      createElement(Input, {
        credential: true,
        type,
        autoComplete: "username",
        spellCheck: true,
        name: "credential",
        defaultValue: "fixture",
        required: true,
      })
    )
    assert.match(html, /data-1p-ignore="true"/)
    assert.match(html, /data-lpignore="true"/)
    assert.match(html, /spellCheck="false"/i)
    assert.match(
      html,
      new RegExp(
        `autoComplete="${type === "password" ? "new-password" : "off"}"`,
        "i"
      )
    )
    assert.match(html, new RegExp(`type="${type}"`))
    assert.match(html, /name="credential"/)
    assert.doesNotMatch(html, /credential="true"/)
  }
})

test("ordinary inputs retain their autofill behavior", () => {
  const html = renderToStaticMarkup(
    createElement(Input, { autoComplete: "email", type: "email" })
  )
  assert.match(html, /autoComplete="email"/i)
  assert.doesNotMatch(html, /data-1p-ignore|data-lpignore/)
})

test("secret fields get a service name while account passwords keep credential semantics", () => {
  const html = renderToStaticMarkup(
    createElement(Input, { credential: true, type: "password" })
  )
  assert.match(html, /autoComplete="new-password"/i)
  assert.match(html, /name="service-secret"/)
  assert.match(html, /data-bwignore="true"/)
  const login = renderToStaticMarkup(
    createElement(Input, {
      type: "password",
      name: "password",
      autoComplete: "current-password",
    })
  )
  assert.match(login, /name="password"/)
  assert.match(login, /autoComplete="current-password"/i)
})
