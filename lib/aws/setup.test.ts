import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { POLICY_REVISION } from "@/convex/ses/contracts"
import {
  buildAwsSetupTemplate,
  buildAwsSetupPolicy,
  buildAwsSendingPolicy,
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
      [{ Ref: "OpensendPolicy" }, { Ref: "OpensendSendingPolicy" }]
    )
    for (const policy of [
      template.Resources.OpensendPolicy,
      template.Resources.OpensendSendingPolicy,
    ]) {
      assert.equal(policy.Type, "AWS::IAM::ManagedPolicy")
      assert.equal(policy.DeletionPolicy, "Retain")
    }
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
    for (const build of [buildAwsSetupPolicy, buildAwsSendingPolicy]) {
      const policy = build(installationId, [
        "us-east-1",
        "eu-west-1",
        "sa-east-1",
        "ap-northeast-1",
      ])
      assert.ok(JSON.stringify(policy).replace(/\s/g, "").length < 6144)
    }
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
describe("AWS sending policy", () => {
  const prefix = `opensend-${installationId}`
  const policy = buildAwsSendingPolicy(installationId, [
    "eu-west-1",
    "us-east-1",
  ])
  const statement = (sid: string) =>
    policy.Statement.find((s) => s.Sid === sid)!
  const arns = (sid: string) => {
    const resource = statement(sid).Resource
    assert.notEqual(resource, "*")
    return typeof resource === "string" ? [] : resource.map((r) => r["Fn::Sub"])
  }
  it("adds one clearly named statement per feature", () => {
    assert.deepEqual(
      policy.Statement.map((s) => s.Sid),
      [
        "SendTeamEmail",
        "ManageSuppressedDestinations",
        "ConfigureTracking",
        "PauseTeamSending",
        "ManageInboundRules",
        "ManageInboundMailBucket",
        "ManageInboundNotifications",
      ]
    )
    // Revision 1 statements stay as they were.
    assert.ok(
      buildAwsSetupPolicy(installationId, ["us-east-1"]).Statement.every(
        (s) => !policy.Statement.some((next) => next.Sid === s.Sid)
      )
    )
  })
  it("sends only through this installation's tenants and configuration sets", () => {
    assert.deepEqual(statement("SendTeamEmail").Action, ["ses:SendEmail"])
    assert.deepEqual(arns("SendTeamEmail"), [
      "arn:${AWS::Partition}:ses:eu-west-1:${AWS::AccountId}:identity/*",
      "arn:${AWS::Partition}:ses:us-east-1:${AWS::AccountId}:identity/*",
      `arn:\${AWS::Partition}:ses:eu-west-1:\${AWS::AccountId}:configuration-set/${prefix}-*`,
      `arn:\${AWS::Partition}:ses:us-east-1:\${AWS::AccountId}:configuration-set/${prefix}-*`,
    ])
    assert.deepEqual(statement("SendTeamEmail").Condition, {
      StringLike: { "ses:TenantName": `${prefix}-t-*` },
    })
  })
  it("scopes tracking, tenant pausing and inbound resources to the installation prefix", () => {
    assert.ok(
      arns("ConfigureTracking").every((arn) =>
        arn.endsWith(`:configuration-set/${prefix}-*`)
      )
    )
    assert.deepEqual(statement("PauseTeamSending").Action, [
      "ses:GetReputationEntity",
      "ses:UpdateReputationEntityCustomerManagedStatus",
    ])
    assert.ok(
      arns("PauseTeamSending").every((arn) =>
        arn.endsWith(`:tenant/${prefix}-t-*`)
      )
    )
    assert.deepEqual(arns("ManageInboundMailBucket"), [
      `arn:\${AWS::Partition}:s3:::${prefix}-inbound*`,
    ])
    assert.ok(
      statement("ManageInboundMailBucket").Action.every((a) =>
        a.startsWith("s3:")
      )
    )
    assert.ok(
      !statement("ManageInboundMailBucket").Action.includes("s3:PutObject")
    )
    assert.ok(
      arns("ManageInboundNotifications").every(
        (arn) =>
          arn.includes(":sns:") &&
          arn.endsWith(`:\${AWS::AccountId}:${prefix}-inbound`)
      )
    )
    assert.equal(arns("ManageInboundNotifications").length, 2)
  })
  it("uses Resource * only where AWS has no resource ARN, and only in the selected regions", () => {
    const wildcards = policy.Statement.filter((s) => s.Resource === "*")
    assert.deepEqual(
      wildcards.map((s) => s.Sid),
      ["ManageSuppressedDestinations", "ManageInboundRules"]
    )
    for (const s of [...wildcards, statement("ManageInboundMailBucket")])
      assert.deepEqual(s.Condition, {
        StringEquals: { "aws:RequestedRegion": ["eu-west-1", "us-east-1"] },
      })
    assert.ok(
      policy.Statement.every((s) =>
        s.Action.every((a) => !a.includes("*") && !a.startsWith("iam:"))
      )
    )
  })
  it("exports the sending policy for the connected account", () => {
    const source = JSON.stringify(
      buildAwsIamPolicy(
        installationId,
        ["us-east-1"],
        "123456789012",
        "sending"
      )
    )
    assert.ok(!source.includes("${"))
    assert.ok(source.includes(`arn:aws:s3:::${prefix}-inbound*`))
    assert.ok(
      source.includes(`arn:aws:ses:us-east-1:123456789012:tenant/${prefix}-t-*`)
    )
  })
  it("names the permissions revision in the setup template", () => {
    const template = buildAwsSetupTemplate({
      installationId,
      regions: ["us-east-1"],
    })
    assert.equal(POLICY_REVISION, 2)
    assert.equal(template.Outputs.PolicyRevision.Value, String(POLICY_REVISION))
    assert.ok(template.Description.includes(`revision ${POLICY_REVISION}`))
    assert.ok(template.Description.length <= 1024)
    assert.deepEqual(
      template.Resources.OpensendSendingPolicy.Properties.PolicyDocument,
      buildAwsSendingPolicy(installationId, ["us-east-1"])
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
