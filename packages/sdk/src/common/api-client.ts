import { version } from "../../package.json"
import type {
  DeleteOptions,
  GetOptions,
  PostOptions,
  PutOptions,
} from "../common/interfaces"
import type { IdempotentRequest } from "../common/interfaces/idempotent-request.interface"
import type { PatchOptions } from "../common/interfaces/patch-option.interface"
import type { ErrorResponse, Response } from "../interfaces"
const defaultUserAgent = `opensend-node:${version}`

// Opensend is self-hosted, so there is no hosted API to default to.
function getDefaultBaseUrl(): string | undefined {
  return typeof process !== "undefined" && process.env
    ? process.env.OPENSEND_BASE_URL || undefined
    : undefined
}

function getDefaultUserAgent(): string {
  return typeof process !== "undefined" && process.env
    ? process.env.OPENSEND_USER_AGENT || defaultUserAgent
    : defaultUserAgent
}

export interface OpensendOptions {
  baseUrl?: string
  userAgent?: string
}

export class ApiClient {
  readonly baseUrl: string
  readonly userAgent: string
  private readonly headers: Headers

  constructor(
    readonly key?: string,
    options?: OpensendOptions
  ) {
    if (!key) {
      if (typeof process !== "undefined" && process.env) {
        this.key = process.env.OPENSEND_API_KEY
      }

      if (!this.key) {
        throw new Error(
          'Missing API key. Pass it to the constructor `new Opensend("os_123")`'
        )
      }
    }

    const baseUrl = options?.baseUrl ?? getDefaultBaseUrl()

    if (!baseUrl) {
      throw new Error(
        "Missing base URL. Pass `baseUrl` or set OPENSEND_BASE_URL to your Opensend API origin, e.g. https://api.example.com"
      )
    }

    this.baseUrl = baseUrl.replace(/\/+$/, "")
    this.userAgent = options?.userAgent ?? getDefaultUserAgent()

    this.headers = new Headers({
      Authorization: `Bearer ${this.key}`,
      "User-Agent": this.userAgent,
      "Content-Type": "application/json",
    })
  }

  private logError(error: ErrorResponse, path: string, status?: number): void {
    if (
      typeof process !== "undefined" &&
      process.env &&
      process.env.NODE_ENV !== "production"
    ) {
      console.error("[Opensend API Error]:", {
        ...(status !== undefined && { status }),
        error,
        path,
      })
    }
  }

  async fetchRequest<T>(path: string, options = {}): Promise<Response<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, options)

      if (!response.ok) {
        try {
          const rawError = await response.text()
          const parsedError = JSON.parse(rawError)

          this.logError(parsedError, path, response.status)

          return {
            data: null,
            error: {
              ...parsedError,
              statusCode:
                typeof parsedError.statusCode === "number"
                  ? parsedError.statusCode
                  : response.status,
            },
            headers: Object.fromEntries(response.headers.entries()),
          }
        } catch (err) {
          if (err instanceof SyntaxError) {
            const error: ErrorResponse = {
              name: "application_error",
              statusCode: response.status,
              message:
                "Internal server error. We are unable to process your request right now, please try again later.",
            }

            this.logError(error, path, response.status)

            return {
              data: null,
              error,
              headers: Object.fromEntries(response.headers.entries()),
            }
          }

          const error: ErrorResponse = {
            message: response.statusText,
            statusCode: response.status,
            name: "application_error",
          }

          if (err instanceof Error) {
            const errorWithMessage = { ...error, message: err.message }

            this.logError(errorWithMessage, path, response.status)

            return {
              data: null,
              error: errorWithMessage,
              headers: Object.fromEntries(response.headers.entries()),
            }
          }

          this.logError(error, path, response.status)

          return {
            data: null,
            error,
            headers: Object.fromEntries(response.headers.entries()),
          }
        }
      }

      const data = await response.json()
      return {
        data,
        error: null,
        headers: Object.fromEntries(response.headers.entries()),
      }
    } catch {
      const error: ErrorResponse = {
        name: "application_error",
        statusCode: null,
        message: "Unable to fetch data. The request could not be resolved.",
      }

      this.logError(error, path)

      return {
        data: null,
        error,
        headers: null,
      }
    }
  }

  async post<T>(
    path: string,
    entity?: unknown,
    options: PostOptions & IdempotentRequest = {}
  ) {
    const headers = new Headers(this.headers)
    const isFormData =
      typeof FormData !== "undefined" && entity instanceof FormData

    if (isFormData) {
      headers.delete("Content-Type")
    }

    if (options.headers) {
      for (const [key, value] of new Headers(options.headers).entries()) {
        headers.set(key, value)
      }
    }
    if (options.idempotencyKey) {
      headers.set("Idempotency-Key", options.idempotencyKey)
    }
    const requestOptions = {
      method: "POST",
      body: isFormData ? entity : JSON.stringify(entity),
      ...options,
      headers,
    }

    return this.fetchRequest<T>(path, requestOptions)
  }

  async get<T>(path: string, options: GetOptions = {}) {
    const headers = new Headers(this.headers)
    if (options.headers) {
      for (const [key, value] of new Headers(options.headers).entries()) {
        headers.set(key, value)
      }
    }
    const requestOptions = {
      method: "GET",
      ...options,
      headers,
    }

    return this.fetchRequest<T>(path, requestOptions)
  }

  async put<T>(path: string, entity: unknown, options: PutOptions = {}) {
    const headers = new Headers(this.headers)
    if (options.headers) {
      for (const [key, value] of new Headers(options.headers).entries()) {
        headers.set(key, value)
      }
    }
    const requestOptions = {
      method: "PUT",
      body: JSON.stringify(entity),
      ...options,
      headers,
    }

    return this.fetchRequest<T>(path, requestOptions)
  }

  async patch<T>(path: string, entity: unknown, options: PatchOptions = {}) {
    const headers = new Headers(this.headers)
    if (options.headers) {
      for (const [key, value] of new Headers(options.headers).entries()) {
        headers.set(key, value)
      }
    }
    const requestOptions = {
      method: "PATCH",
      body: JSON.stringify(entity),
      ...options,
      headers,
    }

    return this.fetchRequest<T>(path, requestOptions)
  }

  async delete<T>(path: string, query?: unknown, options: DeleteOptions = {}) {
    const headers = new Headers(this.headers)
    if (options.headers) {
      for (const [key, value] of new Headers(options.headers).entries()) {
        headers.set(key, value)
      }
    }
    const requestOptions = {
      method: "DELETE",
      body: query === undefined ? undefined : JSON.stringify(query),
      ...options,
      headers,
    }

    return this.fetchRequest<T>(path, requestOptions)
  }
}
