/** V8-safe send client: no file-system uploads or React renderer imports. */
import { ApiClient } from "./common/api-client"
import { parseEmailToApiOptions } from "./common/utils/parse-email-to-api-options"
import type {
  CreateEmailOptions,
  CreateEmailRequestOptions,
  CreateEmailResponseSuccess,
} from "./emails/interfaces/create-email-options.interface"
export type { ErrorResponse } from "./interfaces"
export type { OpensendOptions } from "./common/api-client"
export class Opensend extends ApiClient {
  readonly emails = {
    send: (
      email: Exclude<CreateEmailOptions, { react: unknown }>,
      options: CreateEmailRequestOptions = {}
    ) =>
      this.post<CreateEmailResponseSuccess>(
        "/emails",
        parseEmailToApiOptions(email),
        options
      ),
  }
}
