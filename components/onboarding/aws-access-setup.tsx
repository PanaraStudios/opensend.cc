"use client"
import * as React from "react"
import {
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  UploadIcon,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { copyToClipboard } from "@/components/dashboard/primitives"
import { downloadTextFile } from "@/components/dashboard/domains/shared"
import {
  AWS_SETUP_FILENAME,
  IAM_USERS_URL,
  MAX_CREDENTIAL_CSV_BYTES,
  awsSetupStackName,
  buildAwsSetupTemplate,
  cloudFormationConsoleUrl,
  parseAwsCredentialsCsv,
  validIamUserName,
} from "@/lib/aws/setup"
import type { Region } from "@/lib/dashboard/types"
export function AwsAccessSetup({
  installationId,
  regions,
  defaultRegion,
  compact = false,
}: {
  installationId: string
  regions: Region[]
  defaultRegion: Region
  compact?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button
        type="button"
        variant={compact ? "ghost" : "outline"}
        size={compact ? "sm" : "default"}
        className={compact ? undefined : "w-full"}
        onClick={() => setOpen(true)}
      >
        Create AWS user
        <ArrowUpRightIcon data-icon="inline-end" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <AwsAccessInstructions
          key={`${installationId}:${[...regions].sort().join(",")}`}
          installationId={installationId}
          regions={regions}
          defaultRegion={defaultRegion}
        />
      </Dialog>
    </>
  )
}
function AwsAccessInstructions({
  installationId,
  regions,
  defaultRegion,
}: {
  installationId: string
  regions: Region[]
  defaultRegion: Region
}) {
  const [userName, setUserName] = React.useState("opensend")
  const [downloaded, setDownloaded] = React.useState(false)
  const validName = validIamUserName(userName)
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Create your AWS user</DialogTitle>
        <DialogDescription>
          Three steps in AWS. Permissions are already filled in.
        </DialogDescription>
      </DialogHeader>
      <div className="flex max-h-[65svh] flex-col gap-5 overflow-y-auto py-2">
        <FieldGroup>
          <Field data-invalid={!validName}>
            <FieldLabel htmlFor="aws-setup-user">AWS user name</FieldLabel>
            <Input
              id="aws-setup-user"
              value={userName}
              maxLength={64}
              aria-invalid={!validName}
              onChange={(event) => {
                setUserName(event.target.value)
                setDownloaded(false)
              }}
            />
            <FieldDescription>
              {validName
                ? "Choose another name if this user already exists."
                : "Use letters, numbers, or +=,.@_- (up to 64 characters)."}
            </FieldDescription>
          </Field>
        </FieldGroup>
        <section
          className="flex flex-col gap-2"
          aria-label="Download AWS setup"
        >
          <h3 className="text-sm font-medium">1. Download your setup file</h3>
          <p className="text-sm text-muted-foreground">
            Includes the permissions for {regions.join(", ")}.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={!validName}
            onClick={() => {
              downloadTextFile(
                AWS_SETUP_FILENAME,
                JSON.stringify(
                  buildAwsSetupTemplate({ installationId, regions, userName }),
                  null,
                  2
                ) + "\n"
              )
              setDownloaded(true)
            }}
          >
            {downloaded ? (
              <CheckIcon data-icon="inline-start" />
            ) : (
              <DownloadIcon data-icon="inline-start" />
            )}
            {downloaded ? "Download again" : "Download setup file"}
          </Button>
        </section>
        <Separator />
        <section className="flex flex-col gap-2" aria-label="Approve AWS setup">
          <h3 className="text-sm font-medium">2. Upload and approve in AWS</h3>
          <p className="text-sm text-muted-foreground">
            Choose <strong>Upload a template file</strong>. Use the stack name
            below, keep the defaults, and acknowledge the IAM resources.
          </p>
          <Button
            type="button"
            variant="ghost"
            className="self-start"
            onClick={() =>
              void copyToClipboard(
                awsSetupStackName(installationId),
                "Stack name"
              )
            }
          >
            <CopyIcon data-icon="inline-start" />
            Copy stack name
          </Button>
          <a
            href={cloudFormationConsoleUrl(defaultRegion)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "outline" })}
          >
            Open AWS setup
            <ArrowUpRightIcon data-icon="inline-end" />
          </a>
        </section>
        <Separator />
        <section
          className="flex flex-col gap-2"
          aria-label="Get AWS access key"
        >
          <h3 className="text-sm font-medium">3. Create an access key</h3>
          <p className="text-sm text-muted-foreground">
            When the stack is ready, open{" "}
            <strong>{validName ? userName : "your user"}</strong> →{" "}
            <strong>Security credentials → Create access key</strong>. Download
            the CSV. Find your account ID in the stack’s{" "}
            <strong>Outputs</strong> tab.
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
      </div>
      <DialogFooter>
        <DialogClose render={<Button />}>Back to connection</DialogClose>
      </DialogFooter>
    </DialogContent>
  )
}

export function ImportAwsCredentials({
  onImport,
}: {
  onImport: (credentials: {
    accessKeyId: string
    secretAccessKey: string
  }) => void
}) {
  const input = React.useRef<HTMLInputElement>(null)
  const [error, setError] = React.useState("")
  const [imported, setImported] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        className="sr-only"
        type="file"
        tabIndex={-1}
        accept=".csv,text/csv"
        aria-label="AWS access key CSV"
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ""
          if (!file || pending) return
          setError("")
          setImported(false)
          setPending(true)
          try {
            if (file.size > MAX_CREDENTIAL_CSV_BYTES)
              throw new Error(
                "Choose the small access-key CSV downloaded from AWS"
              )
            const credentials = parseAwsCredentialsCsv(await file.text())
            onImport(credentials)
            setImported(true)
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Could not read the AWS CSV"
            )
          } finally {
            setPending(false)
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        disabled={pending}
        className="self-start"
        onClick={() => input.current?.click()}
      >
        {imported ? (
          <CheckIcon data-icon="inline-start" />
        ) : (
          <UploadIcon data-icon="inline-start" />
        )}
        {pending ? "Reading file…" : "Import AWS key CSV"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {imported && (
        <p role="status" className="text-sm text-muted-foreground">
          Keys imported.
        </p>
      )}
    </div>
  )
}
