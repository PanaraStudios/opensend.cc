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
import type * as api_audience from "../api/audience.js";
import type * as api_caller from "../api/caller.js";
import type * as api_domains from "../api/domains.js";
import type * as api_emails from "../api/emails.js";
import type * as api_events from "../api/events.js";
import type * as api_http from "../api/http.js";
import type * as api_keys from "../api/keys.js";
import type * as api_logs from "../api/logs.js";
import type * as api_paging from "../api/paging.js";
import type * as api_route from "../api/route.js";
import type * as api_state from "../api/state.js";
import type * as api_templates from "../api/templates.js";
import type * as apiKeys from "../apiKeys.js";
import type * as audience from "../audience.js";
import type * as auth from "../auth.js";
import type * as authEmail from "../authEmail.js";
import type * as authHttp from "../authHttp.js";
import type * as authOptions from "../authOptions.js";
import type * as automationDefinition from "../automationDefinition.js";
import type * as automationEventOccurrenceRows from "../automationEventOccurrenceRows.js";
import type * as automationEventRows from "../automationEventRows.js";
import type * as automationEvents from "../automationEvents.js";
import type * as automationRuntime from "../automationRuntime.js";
import type * as automations from "../automations.js";
import type * as contactProperties from "../contactProperties.js";
import type * as contacts from "../contacts.js";
import type * as counts from "../counts.js";
import type * as crons from "../crons.js";
import type * as domains from "../domains.js";
import type * as email_render from "../email/render.js";
import type * as emailRows from "../emailRows.js";
import type * as emailSend from "../emailSend.js";
import type * as emails from "../emails.js";
import type * as events from "../events.js";
import type * as exportRows from "../exportRows.js";
import type * as exportSources from "../exportSources.js";
import type * as exports from "../exports.js";
import type * as http from "../http.js";
import type * as installation from "../installation.js";
import type * as installationActions from "../installationActions.js";
import type * as installationAdmin from "../installationAdmin.js";
import type * as lists from "../lists.js";
import type * as logs from "../logs.js";
import type * as metricRows from "../metricRows.js";
import type * as metrics from "../metrics.js";
import type * as migrations from "../migrations.js";
import type * as oauth from "../oauth.js";
import type * as oauthAdapter from "../oauthAdapter.js";
import type * as oauthAdmin from "../oauthAdmin.js";
import type * as oauthHttp from "../oauthHttp.js";
import type * as oauthProvider from "../oauthProvider.js";
import type * as oidc from "../oidc.js";
import type * as segments from "../segments.js";
import type * as ses_adoption from "../ses/adoption.js";
import type * as ses_aws from "../ses/aws.js";
import type * as ses_contracts from "../ses/contracts.js";
import type * as ses_crypto from "../ses/crypto.js";
import type * as ses_dns from "../ses/dns.js";
import type * as ses_dnsProvider from "../ses/dnsProvider.js";
import type * as ses_domainConnect from "../ses/domainConnect.js";
import type * as ses_events from "../ses/events.js";
import type * as ses_http from "../ses/http.js";
import type * as ses_inbound from "../ses/inbound.js";
import type * as ses_inboundMessages from "../ses/inboundMessages.js";
import type * as ses_inboundRegions from "../ses/inboundRegions.js";
import type * as ses_limits from "../ses/limits.js";
import type * as ses_pacing from "../ses/pacing.js";
import type * as ses_projection from "../ses/projection.js";
import type * as ses_provision from "../ses/provision.js";
import type * as ses_records from "../ses/records.js";
import type * as ses_reputation from "../ses/reputation.js";
import type * as ses_reputationActions from "../ses/reputationActions.js";
import type * as ses_sendContext from "../ses/sendContext.js";
import type * as ses_sns from "../ses/sns.js";
import type * as ses_state from "../ses/state.js";
import type * as ses_tenantActions from "../ses/tenantActions.js";
import type * as ses_tenantProvider from "../ses/tenantProvider.js";
import type * as ses_topics from "../ses/topics.js";
import type * as ses_verify from "../ses/verify.js";
import type * as ses_web from "../ses/web.js";
import type * as ses_workflows from "../ses/workflows.js";
import type * as smtp from "../smtp.js";
import type * as smtpHttp from "../smtpHttp.js";
import type * as sso from "../sso.js";
import type * as suppressions from "../suppressions.js";
import type * as systemEmail from "../systemEmail.js";
import type * as tables_api from "../tables/api.js";
import type * as tables_audience from "../tables/audience.js";
import type * as tables_automationEvents from "../tables/automationEvents.js";
import type * as tables_automations from "../tables/automations.js";
import type * as tables_domains from "../tables/domains.js";
import type * as tables_emails from "../tables/emails.js";
import type * as tables_events from "../tables/events.js";
import type * as tables_exports from "../tables/exports.js";
import type * as tables_metrics from "../tables/metrics.js";
import type * as tables_receiving from "../tables/receiving.js";
import type * as tables_ses from "../tables/ses.js";
import type * as tables_smtp from "../tables/smtp.js";
import type * as tables_templates from "../tables/templates.js";
import type * as tables_unsubscribe from "../tables/unsubscribe.js";
import type * as tables_webhooks from "../tables/webhooks.js";
import type * as teams from "../teams.js";
import type * as templates from "../templates.js";
import type * as tenants from "../tenants.js";
import type * as testHelpers_snsFixture from "../testHelpers/snsFixture.js";
import type * as testEmails from "../testEmails.js";
import type * as topics from "../topics.js";
import type * as unsubscribe from "../unsubscribe.js";
import type * as unsubscribeHttp from "../unsubscribeHttp.js";
import type * as webhookDelivery from "../webhookDelivery.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  "api/audience": typeof api_audience;
  "api/caller": typeof api_caller;
  "api/domains": typeof api_domains;
  "api/emails": typeof api_emails;
  "api/events": typeof api_events;
  "api/http": typeof api_http;
  "api/keys": typeof api_keys;
  "api/logs": typeof api_logs;
  "api/paging": typeof api_paging;
  "api/route": typeof api_route;
  "api/state": typeof api_state;
  "api/templates": typeof api_templates;
  apiKeys: typeof apiKeys;
  audience: typeof audience;
  auth: typeof auth;
  authEmail: typeof authEmail;
  authHttp: typeof authHttp;
  authOptions: typeof authOptions;
  automationDefinition: typeof automationDefinition;
  automationEventOccurrenceRows: typeof automationEventOccurrenceRows;
  automationEventRows: typeof automationEventRows;
  automationEvents: typeof automationEvents;
  automationRuntime: typeof automationRuntime;
  automations: typeof automations;
  contactProperties: typeof contactProperties;
  contacts: typeof contacts;
  counts: typeof counts;
  crons: typeof crons;
  domains: typeof domains;
  "email/render": typeof email_render;
  emailRows: typeof emailRows;
  emailSend: typeof emailSend;
  emails: typeof emails;
  events: typeof events;
  exportRows: typeof exportRows;
  exportSources: typeof exportSources;
  exports: typeof exports;
  http: typeof http;
  installation: typeof installation;
  installationActions: typeof installationActions;
  installationAdmin: typeof installationAdmin;
  lists: typeof lists;
  logs: typeof logs;
  metricRows: typeof metricRows;
  metrics: typeof metrics;
  migrations: typeof migrations;
  oauth: typeof oauth;
  oauthAdapter: typeof oauthAdapter;
  oauthAdmin: typeof oauthAdmin;
  oauthHttp: typeof oauthHttp;
  oauthProvider: typeof oauthProvider;
  oidc: typeof oidc;
  segments: typeof segments;
  "ses/adoption": typeof ses_adoption;
  "ses/aws": typeof ses_aws;
  "ses/contracts": typeof ses_contracts;
  "ses/crypto": typeof ses_crypto;
  "ses/dns": typeof ses_dns;
  "ses/dnsProvider": typeof ses_dnsProvider;
  "ses/domainConnect": typeof ses_domainConnect;
  "ses/events": typeof ses_events;
  "ses/http": typeof ses_http;
  "ses/inbound": typeof ses_inbound;
  "ses/inboundMessages": typeof ses_inboundMessages;
  "ses/inboundRegions": typeof ses_inboundRegions;
  "ses/limits": typeof ses_limits;
  "ses/pacing": typeof ses_pacing;
  "ses/projection": typeof ses_projection;
  "ses/provision": typeof ses_provision;
  "ses/records": typeof ses_records;
  "ses/reputation": typeof ses_reputation;
  "ses/reputationActions": typeof ses_reputationActions;
  "ses/sendContext": typeof ses_sendContext;
  "ses/sns": typeof ses_sns;
  "ses/state": typeof ses_state;
  "ses/tenantActions": typeof ses_tenantActions;
  "ses/tenantProvider": typeof ses_tenantProvider;
  "ses/topics": typeof ses_topics;
  "ses/verify": typeof ses_verify;
  "ses/web": typeof ses_web;
  "ses/workflows": typeof ses_workflows;
  smtp: typeof smtp;
  smtpHttp: typeof smtpHttp;
  sso: typeof sso;
  suppressions: typeof suppressions;
  systemEmail: typeof systemEmail;
  "tables/api": typeof tables_api;
  "tables/audience": typeof tables_audience;
  "tables/automationEvents": typeof tables_automationEvents;
  "tables/automations": typeof tables_automations;
  "tables/domains": typeof tables_domains;
  "tables/emails": typeof tables_emails;
  "tables/events": typeof tables_events;
  "tables/exports": typeof tables_exports;
  "tables/metrics": typeof tables_metrics;
  "tables/receiving": typeof tables_receiving;
  "tables/ses": typeof tables_ses;
  "tables/smtp": typeof tables_smtp;
  "tables/templates": typeof tables_templates;
  "tables/unsubscribe": typeof tables_unsubscribe;
  "tables/webhooks": typeof tables_webhooks;
  teams: typeof teams;
  templates: typeof templates;
  tenants: typeof tenants;
  "testHelpers/snsFixture": typeof testHelpers_snsFixture;
  testEmails: typeof testEmails;
  topics: typeof topics;
  unsubscribe: typeof unsubscribe;
  unsubscribeHttp: typeof unsubscribeHttp;
  webhookDelivery: typeof webhookDelivery;
  webhooks: typeof webhooks;
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
  sendPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"sendPool">;
  webhookPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"webhookPool">;
  contactCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"contactCounts">;
  segmentCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"segmentCounts">;
  segmentMemberCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"segmentMemberCounts">;
  topicCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"topicCounts">;
  propertyCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"propertyCounts">;
  templateCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"templateCounts">;
  apiKeyCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"apiKeyCounts">;
  apiLogCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"apiLogCounts">;
  apiKeyLogCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"apiKeyLogCounts">;
  webhookCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"webhookCounts">;
  deliveryCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"deliveryCounts">;
  domainCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"domainCounts">;
  exportCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"exportCounts">;
  emailCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"emailCounts">;
  reputationCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"reputationCounts">;
  domainMetricCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"domainMetricCounts">;
  emailMetricCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"emailMetricCounts">;
  emailDomainCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"emailDomainCounts">;
  suppressionCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"suppressionCounts">;
  emailRecipientCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"emailRecipientCounts">;
  emailEventCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"emailEventCounts">;
  automationCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"automationCounts">;
  automationRunCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"automationRunCounts">;
  automationStepCounts: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"automationStepCounts">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
