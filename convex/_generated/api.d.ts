/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as auth from "../auth.js";
import type * as authEmail from "../authEmail.js";
import type * as authOptions from "../authOptions.js";
import type * as domains from "../domains.js";
import type * as http from "../http.js";
import type * as installation from "../installation.js";
import type * as installationActions from "../installationActions.js";
import type * as oauth from "../oauth.js";
import type * as oauthAdapter from "../oauthAdapter.js";
import type * as oauthAdmin from "../oauthAdmin.js";
import type * as oauthHttp from "../oauthHttp.js";
import type * as oauthProvider from "../oauthProvider.js";
import type * as oidc from "../oidc.js";
import type * as ses_adoption from "../ses/adoption.js";
import type * as ses_aws from "../ses/aws.js";
import type * as ses_contracts from "../ses/contracts.js";
import type * as ses_crypto from "../ses/crypto.js";
import type * as ses_dns from "../ses/dns.js";
import type * as ses_dnsAutoConfig from "../ses/dnsAutoConfig.js";
import type * as ses_dnsAutoConfigState from "../ses/dnsAutoConfigState.js";
import type * as ses_dnsProvider from "../ses/dnsProvider.js";
import type * as ses_dnsWriters from "../ses/dnsWriters.js";
import type * as ses_events from "../ses/events.js";
import type * as ses_http from "../ses/http.js";
import type * as ses_limits from "../ses/limits.js";
import type * as ses_pacing from "../ses/pacing.js";
import type * as ses_provision from "../ses/provision.js";
import type * as ses_sendContext from "../ses/sendContext.js";
import type * as ses_sns from "../ses/sns.js";
import type * as ses_state from "../ses/state.js";
import type * as ses_tenantActions from "../ses/tenantActions.js";
import type * as ses_tenantProvider from "../ses/tenantProvider.js";
import type * as ses_workflows from "../ses/workflows.js";
import type * as sso from "../sso.js";
import type * as teams from "../teams.js";
import type * as tenants from "../tenants.js";
import type * as testHelpers_snsFixture from "../testHelpers/snsFixture.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  auth: typeof auth;
  authEmail: typeof authEmail;
  authOptions: typeof authOptions;
  domains: typeof domains;
  http: typeof http;
  installation: typeof installation;
  installationActions: typeof installationActions;
  oauth: typeof oauth;
  oauthAdapter: typeof oauthAdapter;
  oauthAdmin: typeof oauthAdmin;
  oauthHttp: typeof oauthHttp;
  oauthProvider: typeof oauthProvider;
  oidc: typeof oidc;
  "ses/adoption": typeof ses_adoption;
  "ses/aws": typeof ses_aws;
  "ses/contracts": typeof ses_contracts;
  "ses/crypto": typeof ses_crypto;
  "ses/dns": typeof ses_dns;
  "ses/dnsAutoConfig": typeof ses_dnsAutoConfig;
  "ses/dnsAutoConfigState": typeof ses_dnsAutoConfigState;
  "ses/dnsProvider": typeof ses_dnsProvider;
  "ses/dnsWriters": typeof ses_dnsWriters;
  "ses/events": typeof ses_events;
  "ses/http": typeof ses_http;
  "ses/limits": typeof ses_limits;
  "ses/pacing": typeof ses_pacing;
  "ses/provision": typeof ses_provision;
  "ses/sendContext": typeof ses_sendContext;
  "ses/sns": typeof ses_sns;
  "ses/state": typeof ses_state;
  "ses/tenantActions": typeof ses_tenantActions;
  "ses/tenantProvider": typeof ses_tenantProvider;
  "ses/workflows": typeof ses_workflows;
  sso: typeof sso;
  teams: typeof teams;
  tenants: typeof tenants;
  "testHelpers/snsFixture": typeof testHelpers_snsFixture;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
