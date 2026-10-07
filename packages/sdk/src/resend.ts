import { KnowledgeBases, BotTools } from "./voice/toolkit"
import { Messages } from "./messages"
import { Ivrs } from "./ivrs/ivrs"
import { VoiceBots } from "./voice/bots"
import { VoiceProviders } from "./voice/providers"
import { Media } from "./media/media"
import { ApiKeys } from "./api-keys/api-keys"
import { Automations } from "./automations/automations"
import { Batch } from "./batch/batch"
import { Broadcasts } from "./broadcasts/broadcasts"
import { ContactProperties } from "./contact-properties/contact-properties"
import { Contacts } from "./contacts/contacts"
import { Domains } from "./domains/domains"
import { Emails } from "./emails/emails"
import { Events } from "./events/events"
import { Logs } from "./logs/logs"
import { OAuthGrants } from "./oauth-grants/oauth-grants"
import { Segments } from "./segments/segments"
import { Suppressions } from "./suppressions/suppressions"
import { Templates } from "./templates/templates"
import { Topics } from "./topics/topics"
import { Usage } from "./usage/usage"
import { Webhooks } from "./webhooks/webhooks"
import { Messenger } from "./messenger/messenger"
import { Instagram } from "./instagram/instagram"
import { WhatsApp } from "./whatsapp/whatsapp"

export { type OpensendOptions } from "./common/api-client"
import { ApiClient, type OpensendOptions } from "./common/api-client"

export class Opensend extends ApiClient {
  readonly segments = new Segments(this)
  readonly apiKeys = new ApiKeys(this)
  /**
   * @deprecated Use segments instead
   */
  readonly audiences = this.segments
  readonly automations = new Automations(this)
  readonly batch = new Batch(this)
  readonly broadcasts = new Broadcasts(this)
  readonly contactProperties = new ContactProperties(this)
  readonly contacts = new Contacts(this)
  readonly domains = new Domains(this)
  readonly messages = new Messages(this)
  readonly emails = new Emails(this)
  readonly events = new Events(this)
  readonly logs = new Logs(this)
  readonly oauthGrants = new OAuthGrants(this)
  readonly suppressions = new Suppressions(this)
  readonly templates = new Templates(this)
  readonly topics = new Topics(this)
  readonly usage = new Usage(this)
  readonly webhooks = new Webhooks(this)
  readonly messenger = new Messenger(this)
  readonly instagram = new Instagram(this)
  readonly knowledgeBases = new KnowledgeBases(this)
  readonly botTools = new BotTools(this)
  readonly voiceBots = new VoiceBots(this)
  readonly voiceProviders = new VoiceProviders(this)
  readonly whatsapp = new WhatsApp(this)
  readonly ivrs = new Ivrs(this)
  readonly media = new Media(this)
}

/** Drop-in names for code written against the `resend` package. */
export const Resend = Opensend
export type Resend = Opensend
export type ResendOptions = OpensendOptions
