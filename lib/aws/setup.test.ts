import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildAwsSetupTemplate,
  buildAwsSetupPolicy,
  buildAwsIamPolicy,
  cloudFormationConsoleUrl,
  awsSetupStackName,
  parseAwsCredentialsCsv,
} from "./setup"
const installationId = "abcdefghijkmnpqrstuvwxyz123456789"
const accessKeyId = "AKIA1234567890123456"
const secretAccessKey = "a".repeat(40)

describe("AWS setup template", () => {
  it("permits identity configuration-set attachment on both resource types", () => {
    const policy = buildAwsSetupPolicy(installationId, ["us-east-1"])
    const grants = policy.Statement.filter((s) =>
      s.Action.includes("ses:PutEmailIdentityConfigurationSetAttributes")
    )
    assert.equal(grants.length, 2)
    assert.ok(JSON.stringify(grants).includes("identity/*"))
    assert.ok(
      JSON.stringify(grants).includes(
        `configuration-set/opensend-${installationId}-*`
      )
    )
    assert.ok(grants.every((grant) => grant.Resource !== "*"))
  })
  it("exports a deployable IAM repair policy with tenant access in the connected account", () => {
    const policy = buildAwsIamPolicy(
      installationId,
      ["us-east-1"],
      "123456789012"
    )
    const source = JSON.stringify(policy)
    assert.ok(!source.includes("Fn::Sub"))
    assert.ok(!source.includes("${"))
    const tenant = policy.Statement.find(
      (statement) => statement.Sid === "ManageTeamTenants"
    )!
    assert.ok(tenant.Action.includes("ses:GetTenant"))
    assert.deepEqual(tenant.Resource, [
      `arn:aws:ses:us-east-1:123456789012:tenant/opensend-${installationId}-t-*`,
    ])
    assert.throws(() => buildAwsIamPolicy(installationId, ["us-east-1"], "*"))
  })
  it("preselects the user and attaches only the generated policy, without creating secrets", () => {
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
    assert.equal(template.Resources.OpensendUser.DeletionPolicy, "Retain")
    assert.deepEqual(template.Outputs.AwsAccountId.Value, {
      Ref: "AWS::AccountId",
    })
    const source = JSON.stringify(template)
    assert.ok(!source.includes("AWS::IAM::AccessKey"))
    assert.ok(!source.includes("LoginProfile"))
    assert.ok(!source.includes("AdministratorAccess"))
    assert.ok(!source.includes("SecretAccessKey"))
  })
  it("limits infrastructure resources to this installation and selected regions", () => {
    const policy = buildAwsSetupPolicy(installationId, [
      "eu-west-1",
      "us-east-1",
      "eu-west-1",
    ])
    for (const statement of policy.Statement) {
      assert.ok(
        statement.Action.every(
          (action) => !action.includes("*") && !action.startsWith("iam:")
        )
      )
      if (typeof statement.Resource === "string") {
        assert.equal(statement.Resource, "*")
        assert.ok(
          [
            "VerifyAccount",
            "ReadSesAccount",
            "CreateTaggedTeamTenants",
          ].includes(statement.Sid)
        )
        continue
      }
      assert.equal(statement.Resource.length, 2)
      for (const arn of statement.Resource) {
        assert.ok(arn["Fn::Sub"].includes("${AWS::AccountId}"))
        assert.ok(!arn["Fn::Sub"].includes("ap-northeast-1"))
        if (statement.Sid !== "ManageSendingDomains")
          assert.ok(arn["Fn::Sub"].includes(installationId))
      }
    }
    assert.deepEqual(
      policy.Statement.find((s) => s.Sid === "ReadSesAccount")?.Condition
        ?.StringEquals["aws:RequestedRegion"],
      ["eu-west-1", "us-east-1"]
    )
  })
  it("supports all offered regions within the IAM managed-policy size limit", () => {
    const policy = buildAwsSetupPolicy(installationId, [
      "us-east-1",
      "eu-west-1",
      "sa-east-1",
      "ap-northeast-1",
    ])
    assert.ok(JSON.stringify(policy).replace(/\s/g, "").length < 6144)
  })
  it("limits tenant creation by region and ownership tags while keeping reads resource-scoped", () => {
    const policy = buildAwsSetupPolicy(installationId, ["us-east-1"])
    const create = policy.Statement.find(
      (s) => s.Sid === "CreateTaggedTeamTenants"
    )!
    assert.deepEqual(create.Action, ["ses:CreateTenant"])
    assert.equal(create.Resource, "*")
    assert.deepEqual(create.Condition, {
      StringEquals: {
        "aws:RequestedRegion": ["us-east-1"],
        "aws:RequestTag/opensend:installation": installationId,
      },
      StringLike: { "aws:RequestTag/opensend:team": "?*" },
    })
    const manage = policy.Statement.find((s) => s.Sid === "ManageTeamTenants")!
    assert.ok(!manage.Action.includes("ses:CreateTenant"))
    assert.ok(manage.Action.includes("ses:GetTenant"))
    assert.notEqual(manage.Resource, "*")
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
