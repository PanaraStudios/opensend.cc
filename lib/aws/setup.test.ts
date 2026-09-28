import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { POLICY_REVISION } from "@/convex/ses/contracts"
import {
  buildAwsSetupTemplate,
  buildAwsPolicy,
  buildAwsIamPolicy,
  cloudFormationConsoleUrl,
  awsSetupStackName,
  parseAwsCredentialsCsv,
} from "./setup"
const installationId = "abcdefghijkmnpqrstuvwxyz123456789"
const accessKeyId = "AKIA1234567890123456"
const secretAccessKey = "a".repeat(40)

describe("AWS policy", () => {
  const prefix = `opensend-${installationId}`
  const policy = buildAwsPolicy(installationId, ["eu-west-1", "us-east-1"])
  const statement = (sid: string) =>
    policy.Statement.find((s) => s.Sid === sid)!
  const arns = (sid: string) => {
    const resource = statement(sid).Resource
    assert.notEqual(resource, "*")
    return typeof resource === "string" ? [] : resource.map((r) => r["Fn::Sub"])
  }
  const inRegions = { "aws:RequestedRegion": ["eu-west-1", "us-east-1"] }

  it("fits every offered region in one managed policy", () => {
    const all = buildAwsIamPolicy(
      installationId,
      ["us-east-1", "eu-west-1", "sa-east-1", "ap-northeast-1"],
      "123456789012"
    )
    // IAM does not count whitespace toward the 6,144-character limit.
    assert.ok(JSON.stringify(all).replace(/\s/g, "").length <= 6144)
  })
  it("limits every regional statement to the enabled regions", () => {
    for (const s of policy.Statement) {
      if (s.Sid === "VerifyAccount") continue
      assert.deepEqual(s.Condition?.StringEquals?.["aws:RequestedRegion"], [
        "eu-west-1",
        "us-east-1",
      ])
    }
    assert.ok(
      policy.Statement.every((s) =>
        s.Action.every((a) => !a.includes("*") && !a.startsWith("iam:"))
      )
    )
  })
  it("uses Resource * only where AWS has no resource ARN", () => {
    assert.deepEqual(
      policy.Statement.filter((s) => s.Resource === "*").map((s) => s.Sid),
      ["VerifyAccount", "UseSesAccount", "CreateTaggedTeamTenants"]
    )
  })
  it("scopes every resource to this installation, except domain identities", () => {
    for (const s of policy.Statement) {
      if (typeof s.Resource === "string") continue
      for (const r of s.Resource) {
        const value = r["Fn::Sub"]
        if (!value.startsWith("arn:${AWS::Partition}:s3:::"))
          assert.ok(value.includes(":*:${AWS::AccountId}:"))
        if (!value.endsWith(":identity/*")) assert.ok(value.includes(prefix))
      }
    }
  })
  it("sends only through this installation's tenants and configuration sets", () => {
    assert.deepEqual(statement("SendTeamEmail").Action, ["ses:SendEmail"])
    assert.deepEqual(arns("SendTeamEmail"), [
      "arn:${AWS::Partition}:ses:*:${AWS::AccountId}:identity/*",
      `arn:\${AWS::Partition}:ses:*:\${AWS::AccountId}:configuration-set/${prefix}-*`,
    ])
    assert.deepEqual(statement("SendTeamEmail").Condition, {
      StringEquals: inRegions,
      StringLike: { "ses:TenantName": `${prefix}-t-*` },
    })
  })
  it("creates tenants only with this installation's ownership tags", () => {
    assert.deepEqual(statement("CreateTaggedTeamTenants").Condition, {
      StringEquals: {
        ...inRegions,
        "aws:RequestTag/opensend:installation": installationId,
      },
      StringLike: { "aws:RequestTag/opensend:team": "?*" },
    })
    assert.ok(statement("ManageTeamTenants").Action.includes("ses:GetTenant"))
    assert.ok(
      statement("ManageTeamTenants").Action.includes(
        "ses:UpdateReputationEntityCustomerManagedStatus"
      )
    )
  })
  it("keeps the inbound drop box to reading and deleting mail", () => {
    assert.deepEqual(arns("ManageInboundMailBucket"), [
      `arn:\${AWS::Partition}:s3:::${prefix}-inbound*`,
    ])
    const actions = statement("ManageInboundMailBucket").Action
    assert.ok(
      actions.includes("s3:GetObject") && actions.includes("s3:DeleteObject")
    )
    assert.ok(!actions.includes("s3:PutObject"))
    assert.deepEqual(
      arns("ManageOpensendNotifications").map((a) => a.split(":").pop()),
      [`${prefix}-events`, `${prefix}-inbound`]
    )
  })
  it("no longer grants SES open/click tracking; Opensend tracks itself", () => {
    assert.ok(
      policy.Statement.every(
        (s) => !s.Action.includes("ses:PutConfigurationSetTrackingOptions")
      )
    )
  })
  it("exports a paste-ready policy for the connected account", () => {
    const source = JSON.stringify(
      buildAwsIamPolicy(installationId, ["us-east-1"], "123456789012")
    )
    assert.ok(!source.includes("Fn::Sub") && !source.includes("${"))
    assert.ok(
      source.includes(`arn:aws:ses:*:123456789012:tenant/${prefix}-t-*`)
    )
    assert.throws(() => buildAwsIamPolicy(installationId, ["us-east-1"], "*"))
  })
})

describe("AWS setup template", () => {
  it("creates the user with the one policy and no secrets", () => {
    const template = buildAwsSetupTemplate({
      installationId,
      regions: ["us-east-1"],
    })
    assert.equal(template.Parameters.UserName.Default, "opensend")
    assert.equal(template.Resources.OpensendUser.Type, "AWS::IAM::User")
    assert.deepEqual(
      template.Resources.OpensendUser.Properties.ManagedPolicyArns,
      [{ Ref: "OpensendPolicy" }]
    )
    assert.equal(
      template.Resources.OpensendPolicy.Type,
      "AWS::IAM::ManagedPolicy"
    )
    assert.equal(template.Resources.OpensendPolicy.DeletionPolicy, "Retain")
    assert.deepEqual(
      template.Resources.OpensendPolicy.Properties.PolicyDocument,
      buildAwsPolicy(installationId, ["us-east-1"])
    )
    assert.equal(template.Resources.OpensendUser.DeletionPolicy, "Retain")
    const source = JSON.stringify(template)
    assert.ok(!source.includes("AWS::IAM::AccessKey"))
    assert.ok(!source.includes("LoginProfile"))
    assert.ok(!source.includes("AdministratorAccess"))
    assert.ok(!source.includes("SecretAccessKey"))
  })
  it("names the permissions revision", () => {
    const template = buildAwsSetupTemplate({
      installationId,
      regions: ["us-east-1"],
    })
    assert.equal(POLICY_REVISION, 2)
    assert.equal(template.Outputs.PolicyRevision.Value, String(POLICY_REVISION))
    assert.ok(template.Description.includes(`revision ${POLICY_REVISION}`))
    assert.ok(template.Description.length <= 1024)
  })
  it("rejects injection, unsupported regions, and invalid IAM names", () => {
    assert.throws(() =>
      buildAwsSetupTemplate({
        installationId: "${Injected}",
        regions: ["us-east-1"],
      })
    )
    assert.throws(() => buildAwsSetupTemplate({ installationId, regions: [] }))
    assert.throws(() =>
      buildAwsSetupTemplate({
        installationId,
        regions: ["us-east-1"],
        userName: "bad/user",
      })
    )
    assert.throws(() => cloudFormationConsoleUrl("invalid" as "us-east-1"))
    assert.equal(
      buildAwsSetupTemplate({
        installationId,
        regions: ["us-east-1"],
        userName: "opensend-test",
      }).Parameters.UserName.Default,
      "opensend-test"
    )
    assert.ok(awsSetupStackName(installationId).startsWith("opensend-access-"))
    assert.equal(
      new URL(cloudFormationConsoleUrl("eu-west-1")).hostname,
      "eu-west-1.console.aws.amazon.com"
    )
  })
})
describe("AWS key CSV import", () => {
  it("reads AWS's two-column download and the older user-name column format", () => {
    assert.deepEqual(
      parseAwsCredentialsCsv(
        `Access key ID,Secret access key\n${accessKeyId},${secretAccessKey}\n`
      ),
      { accessKeyId, secretAccessKey }
    )
    assert.deepEqual(
      parseAwsCredentialsCsv(
        `\uFEFFUser name,Access key ID,Secret access key\r\nopensend,"${accessKeyId}","${secretAccessKey}"\r\n`
      ),
      { accessKeyId, secretAccessKey }
    )
  })
  it("rejects other exports, multiple keys, oversized inputs and ambiguous headers without echoing secrets", () => {
    const invalid = [
      `Email,Password\na@example.test,${secretAccessKey}`,
      `Access key ID,Secret access key\n${accessKeyId},${secretAccessKey}\n${accessKeyId},${secretAccessKey}`,
      `Access key ID,Access key ID,Secret access key\n${accessKeyId},${accessKeyId},${secretAccessKey}`,
      `Access key ID,Secret access key\nASIA1234567890123456,${secretAccessKey}`,
      "x".repeat(16385),
    ]
    for (const csv of invalid)
      assert.throws(
        () => parseAwsCredentialsCsv(csv),
        (error) =>
          error instanceof Error && !error.message.includes(secretAccessKey)
      )
  })
})
