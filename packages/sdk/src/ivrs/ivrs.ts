import type { Opensend } from "../resend"
import type { Ivr, IvrDefinition, IvrPatch } from "./interfaces"
import type { PaginationOptions } from "../common/interfaces/pagination-options.interface"
import type { IdempotentRequest } from "../common/interfaces/idempotent-request.interface"
import type {
  PostOptions,
  GetOptions,
  DeleteOptions,
} from "../common/interfaces"
import type { PatchOptions } from "../common/interfaces/patch-option.interface"
export class Ivrs {
  constructor(private readonly resend: Opensend) {}
  create(input: IvrDefinition, options: PostOptions & IdempotentRequest = {}) {
    return this.resend.post<Ivr>("/ivrs", input, options)
  }
  list(input: PaginationOptions = {}, options: GetOptions = {}) {
    const query = new URLSearchParams()
    for (const [k, v] of Object.entries(input))
      if (v !== undefined) query.set(k, String(v))
    return this.resend.get<{ object: "list"; has_more: boolean; data: Ivr[] }>(
      `/ivrs?${query}`,
      options
    )
  }
  get(id: string, options: GetOptions = {}) {
    return this.resend.get<Ivr>(`/ivrs/${encodeURIComponent(id)}`, options)
  }
  update(id: string, input: IvrPatch, options: PatchOptions = {}) {
    return this.resend.patch<Ivr>(
      `/ivrs/${encodeURIComponent(id)}`,
      input,
      options
    )
  }
  remove(id: string, options: DeleteOptions = {}) {
    return this.resend.delete<{ object: "ivr"; id: string; deleted: true }>(
      `/ivrs/${encodeURIComponent(id)}`,
      undefined,
      options
    )
  }
  validate(id: string, input: IvrPatch = {}, options: PostOptions = {}) {
    return this.resend.post<{ valid: boolean; errors: string[] }>(
      `/ivrs/${encodeURIComponent(id)}/validate`,
      input,
      options
    )
  }
  render(id: string, options: PostOptions = {}) {
    return this.resend.post<Ivr>(
      `/ivrs/${encodeURIComponent(id)}/render`,
      {},
      options
    )
  }
}
