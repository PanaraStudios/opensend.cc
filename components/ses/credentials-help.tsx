"use client"

import * as React from "react"
import { ArrowUpRightIcon, CircleHelpIcon, DownloadIcon } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { downloadTextFile } from "@/components/dashboard/domains/shared"
import { buildAwsIamPolicy, IAM_USERS_URL } from "@/lib/aws/setup"
import type { Region } from "@/lib/dashboard/types"

const canDownloadPolicy = (accountId: string) => /^\d{12}$/.test(accountId)

/** Hands over the IAM policy the connection needs, named for the account and
    regions it was generated for. */
export function DownloadIamPolicyButton({
  installationId,
  accountId,
  regions,
  variant = "outline",
}: {
  installationId: string
  accountId: string
  regions: Region[]
  variant?: React.ComponentProps<typeof Button>["variant"]
}) {
  return (
    <Button
      type="button"
      variant={variant}
      disabled={!canDownloadPolicy(accountId)}
      onClick={() =>
        downloadTextFile(
          "opensend-iam-policy.json",
          JSON.stringify(
            buildAwsIamPolicy(installationId, regions, accountId),
            null,
            2
          ) + "\n"
        )
      }
    >
      <DownloadIcon data-icon="inline-start" />
      Download permissions
    </Button>
  )
}

export function AwsCredentialsHelp({
  installationId,
  accountId,
  regions,
}: {
  installationId: string
  accountId: string
  regions: Region[]
}) {
  const canDownload = canDownloadPolicy(accountId)
  return (
    <Dialog>
      <DialogTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" />}
        aria-label="Help with AWS credentials"
      >
        <CircleHelpIcon />
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Get AWS credentials</DialogTitle>
          <DialogDescription>
            Use an IAM user for Opensend in your AWS account.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60svh] flex-col gap-5 overflow-y-auto py-1">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">1. Open your AWS user</h3>
            <p className="text-sm text-muted-foreground">
              In IAM, choose Users and select the user you created for Opensend.
              If you need a new user, choose Create user first.
            </p>
            <a
              href={IAM_USERS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline" })}
            >
              Open AWS users
              <ArrowUpRightIcon data-icon="inline-end" />
            </a>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">
              2. Add the required permissions
            </h3>
            <p className="text-sm text-muted-foreground">
              If you used Opensend’s AWS setup file, permissions are already
              attached. Otherwise, download the policy below. In IAM → Policies
              → Create policy, select JSON and paste the file’s contents. Save
              the policy, then attach it to your user under Permissions → Add
              permissions → Attach policies directly.
            </p>
            <DownloadIamPolicyButton
              installationId={installationId}
              accountId={accountId}
              regions={regions}
            />
            <p className="text-xs text-muted-foreground">
              {canDownload
                ? `For account ${accountId} and regions ${regions.join(", ")}. Download again if you change the regions.`
                : "Enter your 12-digit AWS account ID in the connection form to download the policy."}
            </p>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">
              3. Create and copy your keys
            </h3>
            <p className="text-sm text-muted-foreground">
              Open your user’s Security credentials tab. Under Access keys,
              choose Create access key and follow the prompts. Copy the Access
              key ID and Secret access key into Opensend, or download the CSV
              and choose Import AWS key CSV.
            </p>
            <p className="text-sm text-muted-foreground">
              AWS only shows the secret when you create the key. If you no
              longer have it, create a new key.
            </p>
          </section>
        </div>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>
            Back to connection
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
