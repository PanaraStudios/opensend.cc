# Opensend v2 live checklist

Run these checks on your real instance at http://localhost:3000. Use your own test
inbox, WhatsApp phone, Facebook Page and Instagram account. Record the time,
message/call ID and result for each step. Use a small audience you control.

1. **Prepare the instance.** Sign in as the owner. In the account menu, open
   Amazon SES and Meta app settings. Confirm your real SES domain is verified,
   receiving is enabled where required, Meta webhook subscriptions are current,
   and all four channels appear as connected in Channels. Configure the calling
   gateway and browser calling address using [calling setup](../calling-gateway.md).
   Expected: the channel details show readable healthy status, and Calling and
   Playground show the configured stack rather than “Calling stack is not configured”.

2. **Prepare API access.** Create a Full access key in API keys and copy it once.
   Set the shell variables below. The API origin is the public Convex HTTP/callback
   origin shown by your installation; it is separate from the dashboard at port 3000.
   Replace each example with your own value.

   ```sh
   export OPENSEND_API_ORIGIN='https://your-callback.example.com'
   export OPENSEND_API_KEY='your-test-api-key'
   export QA_EMAIL_FROM='support@your-verified-domain.example'
   export QA_EMAIL_TO='your-test-inbox@example.com'
   export QA_WHATSAPP_FROM='your-connected-whatsapp-number-id'
   export QA_WHATSAPP_TO='your-test-recipient-international-digits'
   export QA_MESSENGER_FROM='your-facebook-page-id'
   export QA_MESSENGER_TO='your-page-scoped-test-user-id'
   export QA_INSTAGRAM_FROM='your-instagram-account-id'
   export QA_INSTAGRAM_TO='your-instagram-scoped-test-user-id'
   ```

   Expected: the key is listed with Full access and its complete secret is only
   visible in the initial reveal dialog.

3. **Send and receive email.** From your test inbox, send to the receiving address
   on your verified domain. Open Messages → Receiving, choose Email and open it.
   Check the sender, subject, plain text, HTML and attachment. Send an email from
   Playground → Inbox or the API in step 7, then reply from the test inbox.
   Expected: the outbound email reaches the inbox, Sending shows its delivery
   status, and Receiving shows the reply and correct attachment without a crash.

4. **Send and receive WhatsApp.** Message the connected number from your real
   WhatsApp phone to open its service window. In Playground → Inbox, open that
   conversation and reply. Also send an approved WhatsApp template to a test
   recipient outside the service window.
   Expected: both replies arrive on the phone; Messages filters show inbound and
   outbound WhatsApp records with readable statuses and the rendered template body.

5. **Send and receive Messenger.** Message the connected Facebook Page from your
   test Facebook account. Reply in Playground → Inbox within the service window.
   Expected: the Page inbox and test account receive the correct messages;
   Messages → Receiving/Sending → Messenger show the matching conversation and
   Audience links the Page-scoped identity to the contact.

6. **Send and receive Instagram.** Send a direct message to the connected Instagram
   account from your test account, then reply in Playground → Inbox.
   Expected: the reply arrives in Instagram, both Messages filters show it,
   and the contact's Channels section contains the Instagram identity.

7. **Send through `/messages` with curl.** Keep the Meta service windows from steps
   4–6 open. Run each command, saving the returned `id`. `jq` builds JSON safely
   from your shell variables.

   ```sh
   curl -sS "$OPENSEND_API_ORIGIN/messages" \
     -H "Authorization: Bearer $OPENSEND_API_KEY" -H 'Content-Type: application/json' \
     -H 'Idempotency-Key: qa-v2-email-1' \
     --data "$(jq -nc --arg from "$QA_EMAIL_FROM" --arg to "$QA_EMAIL_TO" \
       '{channel:"email",from:$from,to:$to,subject:"Live QA email",text:"Hello from the unified API."}')"

   curl -sS "$OPENSEND_API_ORIGIN/messages" \
     -H "Authorization: Bearer $OPENSEND_API_KEY" -H 'Content-Type: application/json' \
     -H 'Idempotency-Key: qa-v2-whatsapp-1' \
     --data "$(jq -nc --arg from "$QA_WHATSAPP_FROM" --arg to "$QA_WHATSAPP_TO" \
       '{channel:"whatsapp",from:$from,to:$to,text:"Live QA WhatsApp"}')"

   curl -sS "$OPENSEND_API_ORIGIN/messages" \
     -H "Authorization: Bearer $OPENSEND_API_KEY" -H 'Content-Type: application/json' \
     -H 'Idempotency-Key: qa-v2-messenger-1' \
     --data "$(jq -nc --arg from "$QA_MESSENGER_FROM" --arg to "$QA_MESSENGER_TO" \
       '{channel:"messenger",from:$from,to:$to,text:"Live QA Messenger"}')"

   curl -sS "$OPENSEND_API_ORIGIN/messages" \
     -H "Authorization: Bearer $OPENSEND_API_KEY" -H 'Content-Type: application/json' \
     -H 'Idempotency-Key: qa-v2-instagram-1' \
     --data "$(jq -nc --arg from "$QA_INSTAGRAM_FROM" --arg to "$QA_INSTAGRAM_TO" \
       '{channel:"instagram",from:$from,to:$to,text:"Live QA Instagram"}')"

   curl -sS "$OPENSEND_API_ORIGIN/messages?limit=20" \
     -H "Authorization: Bearer $OPENSEND_API_KEY"
   curl -sS "$OPENSEND_API_ORIGIN/messages/MESSAGE_ID" \
     -H "Authorization: Bearer $OPENSEND_API_KEY"
   ```

   Expected: each send returns an ID and reaches the correct test account. Get
   returns the right channel, direction, body and status. The list contains all
   four channels; follow `next_cursor` until null. Repeating an identical send
   with the same idempotency key returns the same ID and sends only once. Changing
   its text while reusing that key returns 409. Choose new keys for a new QA session.

8. **Run a channel-event automation.** Create an automation triggered by WhatsApp
   message received. Add a filter that the message text contains “qa-price”, and
   a reply using the contact's first name and the trigger message text. Start it,
   then send “qa-price please” and a separate “hello” from the phone.
   Expected: only the matching message produces one personalized reply.
   Observability shows one successful run and its resolved inputs. Repeat with
   Messenger and Instagram message received, and Email received with an email
   action. Stop each automation after checking it.

9. **Send small broadcasts.** Create an email broadcast to a segment containing
   only your test inboxes. Check sender, subject, content, audience and unsubscribe
   link in Review, then send. Create a WhatsApp broadcast using an approved template
   and a segment containing only opted-in test phones.
   Expected: Review shows the correct audience, messages arrive once, report totals
   match the test audience and later receipts, and suppressed/unsubscribed contacts
   are excluded. Verify scheduling/canceling with a separate small draft.

10. **Test a knowledge-base answer.** Add a real Gemini provider key in Settings →
    AI providers. In Playground → Knowledge create “QA support”, paste “QA support
    is open Monday to Friday, 9am to 5pm”, and wait for Ready. Test search for
    support hours. Attach it to a voice bot and ask the same question in a test call.
    Expected: search returns the saved document; the bot answers from it. Ask a
    question absent from the material: the bot acknowledges that it lacks an answer.

11. **Test data collection.** On that bot, add a required Order number field and a
    boolean Callback requested field, with a contact property mapping where useful.
    Ask the bot to collect the order number and explicitly say no to a callback.
    Expected: call detail shows the exact order number and “No”; false is retained,
    mapped contact properties update, and `call.data_collected` is emitted once
    with collected values and any missing required fields. Inferred values are marked.

12. **Test a webhook tool.** Create a tool pointing to your controlled public HTTPS
    endpoint, with an order-number parameter, a signing secret and a result-field
    allowlist. Use Send test request, then attach the tool to the bot and ask for
    an order's status in a call.
    Expected: the endpoint receives a signed request, signature verification works
    using [the toolkit signing contract](../voice-bot-toolkit.md), and the bot reads
    only the allowed response fields. Transcript/tool detail records the result and
    latency. Saved secrets are never returned in tool reads or logs.

13. **Check caller lookup.** Give the test phone's Audience contact a name, property,
    segment, note and a recent message. Enable caller context and Look up contact
    on the bot, then call from that phone. Ask the bot to refresh your contact details.
    Expected: the bot uses the matching caller's CRM context without asking for a
    contact ID; the lookup tool returns that caller only. An unknown phone gets
    the unknown-caller behavior. Call detail links the correct contact and shows
    caller/agent turns in time order, even around interruption and tool use.

14. **Receive an IVR call.** Create a two-menu IVR with rendered prompts: press 1
    for Support, then 2 for voicemail. Validate and render it; set your WhatsApp
    number's Call handling to this IVR. Call the number from WhatsApp and press 1,
    then 2. Also test no input and an invalid digit.
    Expected: prompts are clear, each digit is recognized once, the selected path
    and final outcome appear in Playground → Calls, and fallback behavior matches
    the menu. A configured agent/bot handoff keeps the same call.

15. **Receive a bot call.** Set Call handling to your voice bot and call the number.
    Check the greeting/disclosure, answer, interruption, knowledge answer, collection
    and webhook tool, then say goodbye.
    Expected: speech works both ways, interrupting stops the old reply, the bot
    ends the call after its goodbye, and call detail shows ordered transcript,
    summary, tool results, collected data and outcome. Enable recording on a test
    bot if desired and verify the recording is playable after completion.

16. **Check outbound calling permission.** Open the test contact and Call with bot.
    Select the WhatsApp number, request permission within an open service window,
    approve it on the real phone, then refresh permission.
    Expected: the phone receives the permission request and approval is shown.
    A pending request does not start a call automatically. Denial, expired permission
    or Meta limits produces a readable result without allocating an unwanted call.

17. **Place an outbound bot call.** With permission granted, choose your voice bot,
    add a short purpose and any configured variables, then Place call. You can also
    exercise the API:

    ```sh
    curl -sS "$OPENSEND_API_ORIGIN/whatsapp/calls" \
      -H "Authorization: Bearer $OPENSEND_API_KEY" -H 'Content-Type: application/json' \
      -H 'Idempotency-Key: qa-v2-outbound-bot-1' \
      --data "$(jq -nc --arg from "$QA_WHATSAPP_FROM" --arg contact 'CONTACT_ID' \
        --arg route 'bot:BOT_ID' \
        '{from:$from,contact_id:$contact,route:$route,context:"Confirm the QA support request",variables:{order:"ORD-123"}}')"
    ```

    Expected: the phone rings; answering starts the bot greeting and purpose-aware
    conversation. Calls shows Outbound and the correct contact/bot/outcome. Replay
    with the same key returns the same call, without a second ring. Test reject
    and unanswered calls too; their outcomes remain distinct.

18. **Place an outbound IVR call.** In Call with bot choose your rendered IVR, or
    repeat step 17 with `route: "ivr:IVR_ID"` and a new idempotency key. Answer on
    the real phone and select both menu options.
    Expected: the phone rings, both prompts and DTMF work, Calls shows Outbound
    and the correct IVR path/outcome, and permission is enforced for this route too.
    Use a number eligible for business-initiated WhatsApp calling.

19. **Test the softphone.** Enable browser calling, allow microphone access and
    mark an owner/member agent available. Route the number to agents and call it
    from WhatsApp. Answer, speak both ways, mute/unmute, use the keypad and hang up.
    Place a browser outbound call after granting permission. Sign out and try the
    old session in another tab.
    Expected: the available agent gets the ring, controls work, audio is clear,
    Calls records the outcome, and signed-out/revoked agents lose calling access.

20. **Check customer webhooks.** Add your controlled HTTPS endpoint and select the
    message and call events used above. Repeat one send/receive per channel and
    one bot call. Verify signatures and request IDs, and briefly return 500 to
    observe retries in webhook delivery detail.
    Expected: subscribed events contain the correct message/call/contact/channel
    data; signatures verify with the displayed webhook secret; retries are visible
    and your consumer deduplicates event IDs. Payload fields may use API codes;
    ordinary screen labels should remain readable.

21. **Check Custom API key scopes.** Create a Custom key with WhatsApp Write only.
    Repeat the WhatsApp curl send, list `/messages`, then explicitly request
    `/messages?channel=email` and try an email send. Create a Calling Read key and
    fetch a call, then try placing one. Create separate Knowledge Read and Bot
    tools Read keys and try their reads and writes.
    Expected: WhatsApp Write allows WhatsApp reads/sends; unfiltered Messages
    returns only readable channels. Email requests and writes without their scopes
    return 403. Calling Read can read but cannot place calls; knowledge/tool writes
    require Write. Revoking each test key stops its access immediately.

22. **Check desktop/mobile themes and tidy up.** Open the screens you used in
    light and dark, including a 390px-wide browser. Check labels, dialogs, menus,
    readable contrast and scrolling. Stop test automations, remove test-only
    broadcasts/configuration as appropriate, revoke QA keys, and restore your
    intended number routing.
    Expected: no crash, console error or horizontal page overflow, and the real
    instance is left with the owner's intended routing and channel configuration.
